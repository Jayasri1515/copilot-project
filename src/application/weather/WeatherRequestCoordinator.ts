import { operationError, type OperationError } from '../../domain/errors';
import { canonicalIdentity, type LocationIdentity } from '../../domain/identity';
import { formatRetrievalTime } from '../../domain/formatting';
import type {
  ComponentState,
  CurrentConditions,
  Favorite,
  ForecastDay,
  LocationRef,
  UnitPreference,
  WeatherSnapshot,
} from '../../domain/models';
import type { PortResult } from '../../domain/models/results';
import type {
  DeviceLocationPort,
  LocationResolutionPort,
  WeatherComponents,
  WeatherDataPort,
  WeatherRequest,
} from '../ports';
import type { ClockPort } from '../ports';
import {
  FavoritesPreferencesService,
  type PreferencesServiceState,
} from '../favorites';
import type {
  ApplicationEvent,
  ApplicationState,
  WeatherOperationState,
} from '../state';
import type { ManualRetryGate } from './retryPolicy';

export const AGGREGATION_TIMEOUT_MS = 30_000;

interface ForecastComponent {
  readonly value: readonly ForecastDay[] | null;
  readonly timezone: string | null;
}

export interface WeatherComponentOperation {
  readonly current: Promise<PortResult<CurrentConditions | null>>;
  readonly forecast: Promise<PortResult<ForecastComponent>>;
  cancel?(): void;
}

export interface WeatherComponentLoader {
  start(
    request: Readonly<WeatherRequest>,
    options: { readonly signal: AbortSignal },
  ): WeatherComponentOperation;
}

function metadataOf<T>(result: PortResult<T>): { readonly retrievedAtEpochMs?: number } {
  return result.kind === 'failure' ? {} : result.metadata;
}

function componentFrom<T>(
  result: PortResult<T | null>,
): ComponentState<T> {
  if (result.kind !== 'failure') {
    return result.value === null
      ? Object.freeze({ status: 'unavailable' })
      : Object.freeze({ status: 'success', value: result.value });
  }
  if (result.error.category === 'cancelled') {
    return Object.freeze({ status: 'cancelled', error: result.error });
  }
  if (result.error.category === 'timeout') {
    return Object.freeze({ status: 'timeout', error: result.error });
  }
  return Object.freeze({ status: 'error', error: result.error });
}

function failure(error: OperationError): PortResult<never> {
  return { kind: 'failure', error };
}

class CombinedWeatherLoader implements WeatherComponentLoader {
  readonly #weather: WeatherDataPort;

  constructor(weather: WeatherDataPort) {
    this.#weather = weather;
  }

  start(
    request: Readonly<WeatherRequest>,
    options: { readonly signal: AbortSignal },
  ): WeatherComponentOperation {
    const result = this.#weather.getWeather(request, options).catch(() =>
      failure(operationError('network', true, 'network_unavailable')),
    );
    return {
      current: result.then((item) =>
        item.kind === 'failure'
          ? item
          : {
              ...item,
              value: item.value.current,
            }),
      forecast: result.then((item) =>
        item.kind === 'failure'
          ? item
          : {
              ...item,
              value: {
                value: item.value.forecast,
                timezone: item.value.timezone,
              },
            }),
    };
  }
}

function locationFromFavorite(favorite: Favorite): LocationRef {
  return Object.freeze({
    ...favorite,
    timezone: null,
    elevationMetres: null,
  });
}

function deviceLocation(identity: LocationIdentity): LocationRef {
  return Object.freeze({
    identity,
    city: 'Current location',
    administrativeRegion: null,
    country: null,
    timezone: null,
    elevationMetres: null,
  });
}

export class WeatherRequestCoordinator {
  readonly #locations: LocationResolutionPort;
  readonly #device: DeviceLocationPort;
  readonly #loader: WeatherComponentLoader;
  readonly #preferences: FavoritesPreferencesService;
  readonly #clock: ClockPort;
  readonly #manualRetryGate?: ManualRetryGate;
  readonly #listeners = new Set<(event: ApplicationEvent) => void>();
  #state: ApplicationState;
  #token = 0;
  #controller?: AbortController;
  #componentCancel?: () => void;
  #selected?: LocationRef;
  #activeWeatherPromise?: Promise<void>;
  #unsubscribePreferences?: () => void;
  #unitIntent = 0;
  #desiredUnit: UnitPreference;

  constructor(dependencies: {
    readonly locations: LocationResolutionPort;
    readonly deviceLocation: DeviceLocationPort;
    readonly weather?: WeatherDataPort;
    readonly componentLoader?: WeatherComponentLoader;
    readonly preferences: FavoritesPreferencesService;
    readonly clock: ClockPort;
    readonly manualRetryGate?: ManualRetryGate;
  }) {
    if (!dependencies.componentLoader && !dependencies.weather) {
      throw new TypeError('A weather port or component loader is required.');
    }
    this.#locations = dependencies.locations;
    this.#device = dependencies.deviceLocation;
    this.#loader =
      dependencies.componentLoader ??
      new CombinedWeatherLoader(dependencies.weather!);
    this.#preferences = dependencies.preferences;
    this.#clock = dependencies.clock;
    this.#manualRetryGate = dependencies.manualRetryGate;
    this.#desiredUnit = dependencies.preferences.state.document.unit;
    this.#state = Object.freeze({
      preferences: dependencies.preferences.state.document,
      preferenceWarnings: Object.freeze([]),
      search: Object.freeze({ status: 'idle' }),
      deviceLocation: Object.freeze({ status: 'idle' }),
    });
  }

  get state(): ApplicationState {
    return this.#state;
  }

  subscribe(listener: (event: ApplicationEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize(): Promise<ApplicationState> {
    if (!this.#unsubscribePreferences) {
      this.#unsubscribePreferences = this.#preferences.subscribe(
        (state, source) => this.#preferencesChanged(state, source),
      );
    }
    await this.#preferences.initialize();
    return this.#state;
  }

  async search(city: string): Promise<void> {
    const text = typeof city === 'string' ? city.trim() : '';
    const token = this.#supersede();
    if (!text) {
      this.#set({
        search: {
          status: 'error',
          token,
          error: operationError('validation', false, 'request_rejected'),
        },
      });
      return;
    }
    const controller = this.#controller!;
    this.#set({ search: { status: 'loading', token }, operation: undefined });
    const result = await this.#safe(() =>
      this.#locations.search(text, { signal: controller.signal }),
    );
    if (!this.#owns(token)) return this.#reject(token);
    if (result.kind === 'failure') {
      this.#set({ search: { status: 'error', token, error: result.error } });
      return;
    }
    if (result.value.length === 1) {
      this.#set({ search: { status: 'idle' } });
      await this.#select(result.value[0], 'selection', token);
      return;
    }
    this.#set({
      search: {
        status: 'candidates',
        token,
        candidates: Object.freeze([...result.value]),
      },
    });
  }

  selectCandidate(candidate: LocationRef): Promise<void> {
    return this.#select(candidate, 'selection');
  }

  async useDeviceLocation(): Promise<void> {
    const token = this.#supersede();
    const controller = this.#controller!;
    this.#set({
      deviceLocation: { status: 'loading', token },
      operation: undefined,
    });
    const result = await this.#safe(() =>
      this.#device.locate({ signal: controller.signal }),
    );
    if (!this.#owns(token)) return this.#reject(token);
    if (result.kind === 'failure') {
      this.#set({
        deviceLocation: { status: 'error', token, error: result.error },
      });
      return;
    }
    this.#set({ deviceLocation: { status: 'idle' } });
    await this.#select(deviceLocation(result.value), 'selection', token);
  }

  selectFavorite(favorite: Favorite): Promise<void> {
    return this.#select(locationFromFavorite(favorite), 'selection');
  }

  async changeUnit(unit: UnitPreference): Promise<void> {
    if (unit !== 'celsius' && unit !== 'fahrenheit') return;
    if (unit === this.#desiredUnit) return;
    this.#desiredUnit = unit;
    const intent = ++this.#unitIntent;
    const persisted = await this.#preferences.setUnit(unit);
    if (intent !== this.#unitIntent) return;
    if (!persisted) {
      this.#desiredUnit = this.#preferences.state.document.unit;
      return;
    }
    if (persisted && this.#selected) await this.#select(this.#selected, 'unit');
  }

  refresh(): Promise<void> {
    if (!this.#selected) return Promise.resolve();
    if (this.#state.operation?.reason === 'refresh' && this.#activeWeatherPromise) {
      this.#emit({
        type: 'duplicate_refresh_ignored',
        token: this.#state.operation.token,
      });
      return this.#activeWeatherPromise;
    }
    return this.#select(this.#selected, 'refresh');
  }

  retry(): Promise<void> {
    if (!this.#selected) return Promise.resolve();
    const scope = 'open-meteo';
    const gate = this.#manualRetryGate?.tryStart(scope);
    if (gate && !gate.allowed) {
      this.#set({ retryBlockedUntilEpochMs: gate.retryAllowedAtEpochMs });
      this.#emit({
        type: 'retry_blocked',
        retryAllowedAtEpochMs: gate.retryAllowedAtEpochMs,
      });
      return Promise.resolve();
    }
    return this.#select(this.#selected, 'retry');
  }

  addSelectedFavorite(): Promise<boolean> {
    if (
      !this.#selected ||
      !this.#state.weather ||
      canonicalIdentity(this.#selected.identity) !==
        canonicalIdentity(this.#state.weather.identity) ||
      (this.#state.weather.current.status !== 'success' &&
        this.#state.weather.forecast.status !== 'success')
    ) {
      return Promise.resolve(false);
    }
    return this.#preferences.add({
      identity: this.#selected.identity,
      city: this.#selected.city,
      administrativeRegion: this.#selected.administrativeRegion,
      country: this.#selected.country,
    });
  }

  removeFavorite(identity: LocationIdentity): Promise<boolean> {
    return this.#preferences.remove(identity);
  }

  clearFavorites(): Promise<boolean> {
    return this.#preferences.clear();
  }

  dispose(): void {
    this.#controller?.abort();
    this.#componentCancel?.();
    this.#unsubscribePreferences?.();
    this.#unsubscribePreferences = undefined;
    this.#listeners.clear();
  }

  async #select(
    location: LocationRef,
    reason: WeatherOperationState['reason'],
    existingToken?: number,
  ): Promise<void> {
    const token = existingToken ?? this.#supersede();
    if (!this.#owns(token)) return;
    this.#selected = location;
    const unit = this.#preferences.state.document.unit;
    const operation: WeatherOperationState = Object.freeze({
      status: 'loading',
      token,
      reason,
      location,
      unit,
    });
    this.#set({
      operation,
      retryBlockedUntilEpochMs: undefined,
      search: { status: 'idle' },
    });
    const promise = this.#loadWeather(operation, this.#controller!);
    this.#activeWeatherPromise = promise;
    await promise;
    if (this.#activeWeatherPromise === promise) this.#activeWeatherPromise = undefined;
  }

  async #loadWeather(
    operation: WeatherOperationState,
    controller: AbortController,
  ): Promise<void> {
    let components: WeatherComponentOperation;
    try {
      components = this.#loader.start(
        { identity: operation.location.identity, unit: operation.unit },
        { signal: controller.signal },
      );
    } catch {
      const error = failure(
        operationError('network', true, 'network_unavailable'),
      );
      components = { current: Promise.resolve(error), forecast: Promise.resolve(error) };
    }
    this.#componentCancel = components.cancel;
    const [currentResult, forecastResult] = await Promise.all([
      this.#bounded(components.current, controller.signal),
      this.#bounded(components.forecast, controller.signal),
    ]);
    if (!this.#owns(operation.token)) return this.#reject(operation.token);

    const current = componentFrom(currentResult);
    const forecast = componentFrom(
      forecastResult.kind === 'failure'
        ? forecastResult
        : { ...forecastResult, value: forecastResult.value.value },
    );
    const prior = this.#state.weather;
    const retain =
      (operation.reason === 'refresh' || operation.reason === 'retry') &&
      prior !== undefined &&
      canonicalIdentity(prior.identity) ===
        canonicalIdentity(operation.location.identity) &&
      prior.unit === operation.unit;
    const retainedCurrent =
      retain && current.status !== 'success'
        ? prior.current.status === 'success'
          ? prior.current.value
          : prior.retained?.current
        : undefined;
    const retainedForecast =
      retain && forecast.status !== 'success'
        ? prior.forecast.status === 'success'
          ? prior.forecast.value
          : prior.retained?.forecast
        : undefined;
    const stale = retainedCurrent !== undefined || retainedForecast !== undefined;

    const successfulTimes = [
      ...(current.status === 'success'
        ? [metadataOf(currentResult).retrievedAtEpochMs]
        : []),
      ...(forecast.status === 'success'
        ? [metadataOf(forecastResult).retrievedAtEpochMs]
        : []),
    ].filter((value): value is number => value !== undefined);
    const timezone =
      forecastResult.kind === 'failure' ? null : forecastResult.value.timezone;
    const retrievalEpoch =
      successfulTimes.length > 0
        ? Math.max(...successfulTimes, this.#clock.nowEpochMs())
        : undefined;
    const retrievedAt =
      retrievalEpoch === undefined
        ? retain
          ? prior?.retrievedAt
          : undefined
        : formatRetrievalTime(retrievalEpoch, timezone) ??
          (retain ? prior?.retrievedAt : undefined);

    const snapshot: WeatherSnapshot = Object.freeze({
      requestToken: operation.token,
      identity: operation.location.identity,
      unit: operation.unit,
      current,
      forecast,
      ...(retrievedAt ? { retrievedAt } : {}),
      stale,
      ...(stale
        ? {
            retained: Object.freeze({
              ...(retainedCurrent ? { current: retainedCurrent } : {}),
              ...(retainedForecast ? { forecast: retainedForecast } : {}),
            }),
          }
        : {}),
    });
    this.#set({ weather: snapshot, operation: undefined });
  }

  async #bounded<T>(
    promise: Promise<PortResult<T>>,
    signal: AbortSignal,
  ): Promise<PortResult<T>> {
    const timeoutController = new AbortController();
    const timeout = this.#clock
      .delay(AGGREGATION_TIMEOUT_MS, timeoutController.signal)
      .then(() =>
        failure(operationError('timeout', true, 'request_timed_out')),
      )
      .catch(() =>
        failure(operationError('cancelled', false, 'operation_cancelled')),
      );
    const cancelled = new Promise<PortResult<never>>((resolve) => {
      if (signal.aborted) {
        resolve(failure(operationError('cancelled', false, 'operation_cancelled')));
      } else {
        signal.addEventListener(
          'abort',
          () =>
            resolve(
              failure(operationError('cancelled', false, 'operation_cancelled')),
            ),
          { once: true },
        );
      }
    });
    const result = await Promise.race([
      promise.catch(() =>
        failure(operationError('network', true, 'network_unavailable')),
      ),
      timeout,
      cancelled,
    ]);
    timeoutController.abort();
    return result;
  }

  async #safe<T>(operation: () => Promise<PortResult<T>>): Promise<PortResult<T>> {
    try {
      return await operation();
    } catch {
      return failure(operationError('network', true, 'network_unavailable'));
    }
  }

  #supersede(): number {
    const oldToken = this.#token;
    if (oldToken > 0) {
      this.#controller?.abort();
      this.#componentCancel?.();
      this.#emit({ type: 'request_superseded', token: oldToken });
    }
    this.#token += 1;
    this.#controller = new AbortController();
    this.#componentCancel = undefined;
    return this.#token;
  }

  #owns(token: number): boolean {
    return token === this.#token && !this.#controller?.signal.aborted;
  }

  #reject(token: number): void {
    this.#emit({ type: 'stale_result_rejected', token });
  }

  #preferencesChanged(
    preferences: PreferencesServiceState,
    source: 'initial' | 'local' | 'external',
  ): void {
    const oldUnit = this.#state.preferences.unit;
    if (source !== 'local') {
      this.#desiredUnit = preferences.document.unit;
      this.#unitIntent += 1;
    }
    this.#set({
      preferences: preferences.document,
      preferenceWarnings: preferences.warnings,
      preferenceError: preferences.error,
    });
    if (
      source === 'external' &&
      oldUnit !== preferences.document.unit &&
      this.#selected
    ) {
      void this.#select(this.#selected, 'unit');
    }
  }

  #set(change: Partial<ApplicationState>): void {
    const next = { ...this.#state, ...change };
    for (const key of Object.keys(next) as (keyof ApplicationState)[]) {
      if (next[key] === undefined) delete (next as Record<string, unknown>)[key];
    }
    this.#state = Object.freeze(next);
    this.#emit({ type: 'state_changed', state: this.#state });
  }

  #emit(event: ApplicationEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
