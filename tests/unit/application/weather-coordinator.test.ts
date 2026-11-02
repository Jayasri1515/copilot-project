import { describe, expect, it, vi } from 'vitest';
import { MemoryPreferencesRepository } from '../../../src/adapters/storage/MemoryPreferencesRepository';
import { FavoritesPreferencesService } from '../../../src/application/favorites';
import type {
  ClockPort,
  DeviceLocationPort,
  LocationResolutionPort,
} from '../../../src/application/ports';
import {
  WeatherRequestCoordinator,
  type WeatherComponentLoader,
  type WeatherComponentOperation,
} from '../../../src/application/weather';
import { operationError } from '../../../src/domain/errors';
import { createDeviceIdentity, createSearchIdentity } from '../../../src/domain/identity';
import type {
  CurrentConditions,
  Favorite,
  ForecastDay,
  LocationRef,
} from '../../../src/domain/models';
import type { PortResult } from '../../../src/domain/models/results';

const metadata = Object.freeze({ retrievedAtEpochMs: 1_782_804_000_000 });
const current: CurrentConditions = Object.freeze({
  temperature: 24,
  humidityPercent: 60,
  condition: null,
});
const forecast: readonly ForecastDay[] = Object.freeze([
  Object.freeze({
    date: '2026-07-01',
    temperatureMax: 28,
    temperatureMin: 20,
    condition: null,
  }),
]);

function location(id = 1, city = 'Mumbai'): LocationRef {
  return Object.freeze({
    identity: createSearchIdentity({
      providerId: id,
      latitude: 19,
      longitude: 72,
    })!,
    city,
    administrativeRegion: 'Maharashtra',
    country: 'India',
    timezone: 'Asia/Kolkata',
    elevationMetres: null,
  });
}

const success = <T,>(value: T): PortResult<T> => ({
  kind: 'success',
  value,
  metadata,
});
const unavailable = <T,>(): PortResult<T | null> => success(null);
const failed = (
  category: 'network' | 'timeout' | 'cancelled' | 'rate_limited' = 'network',
): PortResult<never> => ({
  kind: 'failure',
  error:
    category === 'timeout'
      ? operationError('timeout', true, 'request_timed_out')
      : category === 'cancelled'
        ? operationError('cancelled', false, 'operation_cancelled')
        : category === 'rate_limited'
          ? operationError('rate_limited', true, 'rate_limited', 5_000)
          : operationError('network', true, 'network_unavailable'),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeClock implements ClockPort {
  now = 1_782_804_000_000;
  readonly waits: { milliseconds: number; resolve: () => void }[] = [];

  nowEpochMs(): number {
    return this.now;
  }

  delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waits.push({ milliseconds, resolve });
      signal?.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    });
  }
}

class QueueLoader implements WeatherComponentLoader {
  readonly operations: WeatherComponentOperation[] = [];
  readonly requests: { unit: string; signal: AbortSignal }[] = [];

  start(
    request: { readonly unit: 'celsius' | 'fahrenheit' },
    options: { readonly signal: AbortSignal },
  ): WeatherComponentOperation {
    this.requests.push({ unit: request.unit, signal: options.signal });
    const operation = this.operations.shift();
    if (!operation) throw new Error('No queued weather operation');
    return operation;
  }
}

function pair(
  currentResult: PortResult<CurrentConditions | null> = success(current),
  forecastResult: PortResult<{
    readonly value: readonly ForecastDay[] | null;
    readonly timezone: string | null;
  }> = success({ value: forecast, timezone: 'Asia/Kolkata' }),
): WeatherComponentOperation {
  return {
    current: Promise.resolve(currentResult),
    forecast: Promise.resolve(forecastResult),
  };
}

function harness(options: {
  loader?: QueueLoader;
  locations?: LocationResolutionPort;
  device?: DeviceLocationPort;
  retryGate?: {
    tryStart(scope: string):
      | { readonly allowed: true }
      | { readonly allowed: false; readonly retryAllowedAtEpochMs: number };
  };
} = {}) {
  const loader = options.loader ?? new QueueLoader();
  const preferences = new FavoritesPreferencesService(
    new MemoryPreferencesRepository(),
  );
  const coordinator = new WeatherRequestCoordinator({
    locations:
      options.locations ??
      ({ search: vi.fn(async () => success([location()])) } satisfies LocationResolutionPort),
    deviceLocation:
      options.device ??
      ({
        locate: vi.fn(async () =>
          success(createDeviceIdentity({ latitude: 10, longitude: 20 })!),
        ),
      } satisfies DeviceLocationPort),
    componentLoader: loader,
    preferences,
    clock: new FakeClock(),
    ...(options.retryGate
      ? { manualRetryGate: options.retryGate as never }
      : {}),
  });
  return { coordinator, loader, preferences };
}

describe('WeatherRequestCoordinator aggregation', () => {
  it.each([
    ['success', success(current)],
    ['unavailable', unavailable<CurrentConditions>()],
    ['error', failed('network')],
    ['timeout', failed('timeout')],
    ['cancelled', failed('cancelled')],
  ] as const)(
    'publishes current %s only after forecast is terminal',
    async (status, currentResult) => {
      const future = deferred<
        PortResult<{ value: readonly ForecastDay[] | null; timezone: string | null }>
      >();
      const loader = new QueueLoader();
      loader.operations.push({
        current: Promise.resolve(currentResult),
        forecast: future.promise,
      });
      const { coordinator } = harness({ loader });
      await coordinator.initialize();
      const loading = coordinator.selectCandidate(location());
      await Promise.resolve();
      expect(coordinator.state.weather).toBeUndefined();
      future.resolve(success({ value: forecast, timezone: 'Asia/Kolkata' }));
      await loading;
      expect(coordinator.state.weather?.current.status).toBe(status);
      expect(coordinator.state.weather?.forecast.status).toBe('success');
    },
  );

  it.each([
    ['success', success({ value: forecast, timezone: 'Asia/Kolkata' })],
    ['unavailable', success({ value: null, timezone: 'Asia/Kolkata' })],
    ['error', failed('network')],
    ['timeout', failed('timeout')],
    ['cancelled', failed('cancelled')],
  ] as const)('maps forecast %s terminal state', async (status, result) => {
    const loader = new QueueLoader();
    loader.operations.push(pair(success(current), result));
    const { coordinator } = harness({ loader });
    await coordinator.initialize();
    await coordinator.selectCandidate(location());
    expect(coordinator.state.weather?.forecast.status).toBe(status);
  });

  it('bounds a hanging component and publishes the useful component atomically', async () => {
    const loader = new QueueLoader();
    loader.operations.push({
      current: Promise.resolve(success(current)),
      forecast: new Promise(() => undefined),
    });
    const clock = new FakeClock();
    const preferences = new FavoritesPreferencesService(
      new MemoryPreferencesRepository(),
    );
    const coordinator = new WeatherRequestCoordinator({
      locations: { search: async () => success([location()]) },
      deviceLocation: {
        locate: async () => success(createDeviceIdentity({ latitude: 1, longitude: 2 })!),
      },
      componentLoader: loader,
      preferences,
      clock,
    });
    await coordinator.initialize();
    const loading = coordinator.selectCandidate(location());
    await Promise.resolve();
    expect(clock.waits.every(({ milliseconds }) => milliseconds === 30_000)).toBe(true);
    for (const wait of clock.waits) wait.resolve();
    await loading;
    expect(coordinator.state.weather).toMatchObject({
      current: { status: 'success' },
      forecast: { status: 'timeout' },
      stale: false,
    });
  });

  it('retains only matching prior values as stale after refresh failure', async () => {
    const loader = new QueueLoader();
    loader.operations.push(pair(), pair(failed(), failed()));
    const { coordinator } = harness({ loader });
    await coordinator.initialize();
    await coordinator.selectCandidate(location());
    const retrievedAt = coordinator.state.weather?.retrievedAt;
    await coordinator.refresh();
    expect(coordinator.state.weather).toMatchObject({
      stale: true,
      current: { status: 'error' },
      forecast: { status: 'error' },
      retained: { current, forecast },
      retrievedAt,
    });
  });
});

describe('WeatherRequestCoordinator flows and races', () => {
  it('handles empty, not-found, ambiguous, and single-result searches', async () => {
    const searches: PortResult<readonly LocationRef[]>[] = [
      failed() as PortResult<readonly LocationRef[]>,
      success([location(1), location(2, 'Pune')]),
      success([location(3, 'Delhi')]),
    ];
    const search = vi.fn(async () => searches.shift()!);
    const loader = new QueueLoader();
    loader.operations.push(pair());
    const { coordinator } = harness({ loader, locations: { search } });
    await coordinator.initialize();
    await coordinator.search(' ');
    expect(search).not.toHaveBeenCalled();
    expect(coordinator.state.search).toMatchObject({ status: 'error' });
    await coordinator.search('Missing');
    expect(coordinator.state.search).toMatchObject({ status: 'error' });
    await coordinator.search('Ambiguous');
    expect(coordinator.state.search).toMatchObject({
      status: 'candidates',
      candidates: [{ city: 'Mumbai' }, { city: 'Pune' }],
    });
    expect(loader.requests).toHaveLength(0);
    await coordinator.search('Delhi');
    expect(loader.requests).toHaveLength(1);
    expect(coordinator.state.weather?.identity).toEqual(location(3).identity);
  });

  it.each(['permission_denied', 'timeout'] as const)(
    'keeps search safe after device %s',
    async (category) => {
      const device: DeviceLocationPort = {
        locate: async () =>
          failed(category === 'timeout' ? 'timeout' : 'network') as never,
      };
      if (category === 'permission_denied') {
        device.locate = async () => ({
          kind: 'failure',
          error: operationError(
            'permission_denied',
            false,
            'location_permission_denied',
          ),
        });
      }
      const { coordinator } = harness({ device });
      await coordinator.initialize();
      await coordinator.useDeviceLocation();
      expect(coordinator.state.deviceLocation).toMatchObject({
        status: 'error',
        error: { category },
      });
      expect(coordinator.state.search.status).toBe('idle');
    },
  );

  it('rejects late selection results and cancels the superseded signal', async () => {
    const oldCurrent = deferred<PortResult<CurrentConditions | null>>();
    const oldForecast =
      deferred<PortResult<{ value: readonly ForecastDay[] | null; timezone: string | null }>>();
    const loader = new QueueLoader();
    loader.operations.push(
      { current: oldCurrent.promise, forecast: oldForecast.promise },
      pair(success({ ...current, temperature: 30 })),
    );
    const { coordinator } = harness({ loader });
    const events: string[] = [];
    coordinator.subscribe((event) => events.push(event.type));
    await coordinator.initialize();
    const first = coordinator.selectCandidate(location(1));
    await Promise.resolve();
    const firstSignal = loader.requests[0].signal;
    await coordinator.selectCandidate(location(2, 'Pune'));
    expect(firstSignal.aborted).toBe(true);
    oldCurrent.resolve(success(current));
    oldForecast.resolve(success({ value: forecast, timezone: 'Asia/Kolkata' }));
    await first;
    expect(coordinator.state.weather?.identity).toEqual(location(2).identity);
    expect(events).toContain('stale_result_rejected');
  });

  it('single-flights duplicate refresh actions', async () => {
    const pending = deferred<PortResult<CurrentConditions | null>>();
    const pendingForecast =
      deferred<PortResult<{ value: readonly ForecastDay[] | null; timezone: string | null }>>();
    const loader = new QueueLoader();
    loader.operations.push(pair(), {
      current: pending.promise,
      forecast: pendingForecast.promise,
    });
    const { coordinator } = harness({ loader });
    const duplicate = vi.fn();
    coordinator.subscribe((event) => {
      if (event.type === 'duplicate_refresh_ignored') duplicate();
    });
    await coordinator.initialize();
    await coordinator.selectCandidate(location());
    const one = coordinator.refresh();
    const two = coordinator.refresh();
    expect(loader.requests).toHaveLength(2);
    expect(duplicate).toHaveBeenCalledOnce();
    pending.resolve(success(current));
    pendingForecast.resolve(success({ value: forecast, timezone: 'Asia/Kolkata' }));
    await Promise.all([one, two]);
  });

  it('persists a unit before refetch and never relabels old temperatures', async () => {
    const next = deferred<PortResult<CurrentConditions | null>>();
    const nextForecast =
      deferred<PortResult<{ value: readonly ForecastDay[] | null; timezone: string | null }>>();
    const loader = new QueueLoader();
    loader.operations.push(pair(), {
      current: next.promise,
      forecast: nextForecast.promise,
    });
    const { coordinator } = harness({ loader });
    await coordinator.initialize();
    await coordinator.selectCandidate(location());
    const changing = coordinator.changeUnit('fahrenheit');
    await vi.waitFor(() => expect(loader.requests).toHaveLength(2));
    expect(coordinator.state.preferences.unit).toBe('fahrenheit');
    expect(coordinator.state.weather?.unit).toBe('celsius');
    expect(coordinator.state.operation?.unit).toBe('fahrenheit');
    next.resolve(success({ ...current, temperature: 75 }));
    nextForecast.resolve(success({ value: forecast, timezone: 'Asia/Kolkata' }));
    await changing;
    expect(coordinator.state.weather).toMatchObject({
      unit: 'fahrenheit',
      current: { status: 'success', value: { temperature: 75 } },
    });
  });

  it('lets the latest unit intent win without publishing the superseded unit', async () => {
    const loader = new QueueLoader();
    loader.operations.push(pair(), pair());
    const { coordinator } = harness({ loader });
    await coordinator.initialize();
    await coordinator.selectCandidate(location());
    const fahrenheit = coordinator.changeUnit('fahrenheit');
    const celsius = coordinator.changeUnit('celsius');
    await Promise.all([fahrenheit, celsius]);
    expect(coordinator.state.preferences.unit).toBe('celsius');
    expect(coordinator.state.weather?.unit).toBe('celsius');
    expect(loader.requests.map(({ unit }) => unit)).toEqual([
      'celsius',
      'celsius',
    ]);
  });

  it('propagates rate-limit failures and blocks retry through the manual gate', async () => {
    const loader = new QueueLoader();
    loader.operations.push(pair(failed('rate_limited'), failed('rate_limited')));
    const { coordinator } = harness({
      loader,
      retryGate: {
        tryStart: () => ({
          allowed: false,
          retryAllowedAtEpochMs: 1_782_804_005_000,
        }),
      },
    });
    await coordinator.initialize();
    await coordinator.selectCandidate(location());
    expect(coordinator.state.weather?.current).toMatchObject({
      status: 'error',
      error: { category: 'rate_limited', retryAfterMs: 5_000 },
    });
    await coordinator.retry();
    expect(coordinator.state.retryBlockedUntilEpochMs).toBe(1_782_804_005_000);
    expect(loader.requests).toHaveLength(1);
  });

  it('selects, adds, selects again, removes, and clears favorites', async () => {
    const loader = new QueueLoader();
    loader.operations.push(pair(), pair());
    const { coordinator } = harness({ loader });
    await coordinator.initialize();
    await coordinator.selectCandidate(location());
    expect(await coordinator.addSelectedFavorite()).toBe(true);
    const favorite = coordinator.state.preferences.favorites[0] as Favorite;
    await coordinator.selectFavorite(favorite);
    expect(coordinator.state.weather?.identity).toEqual(favorite.identity);
    expect(await coordinator.removeFavorite(favorite.identity)).toBe(true);
    expect(coordinator.state.preferences.favorites).toHaveLength(0);
    expect(await coordinator.clearFavorites()).toBe(true);
  });
});
