import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ApplicationEvent,
  ApplicationState,
} from '../../application/state';
import type { WeatherRequestCoordinator } from '../../application/weather';
import { canonicalIdentity } from '../../domain/identity';
import {
  formatForecastDate,
  formatTemperature,
} from '../../domain/formatting';
import type {
  ComponentState,
  CurrentConditions,
  Favorite,
  ForecastDay,
  LocationRef,
  UnitPreference,
} from '../../domain/models';
import { ConditionIcon } from '../weather/ConditionIcon';
import './app.css';

export interface WeatherController {
  readonly state: ApplicationState;
  subscribe(listener: (event: ApplicationEvent) => void): () => void;
  initialize(): Promise<ApplicationState>;
  search(city: string): Promise<void>;
  selectCandidate(candidate: LocationRef): Promise<void>;
  useDeviceLocation(): Promise<void>;
  selectFavorite(favorite: Favorite): Promise<void>;
  changeUnit(unit: UnitPreference): Promise<void>;
  refresh(): Promise<void>;
  retry(): Promise<void>;
  addSelectedFavorite(): Promise<boolean>;
  removeFavorite(identity: Favorite['identity']): Promise<boolean>;
  clearFavorites(): Promise<boolean>;
  dispose(): void;
}

const emptyState: ApplicationState = Object.freeze({
  preferences: Object.freeze({
    version: 1,
    unit: 'celsius',
    favorites: Object.freeze([]),
  }),
  preferenceWarnings: Object.freeze([]),
  search: Object.freeze({ status: 'idle' }),
  deviceLocation: Object.freeze({ status: 'idle' }),
});

const errorCopy = {
  city_not_found: 'City not found. Check the spelling and try again.',
  location_permission_denied:
    'Location permission was denied. You can still search by city.',
  location_unavailable:
    'Your location could not be determined. You can still search by city.',
  request_timed_out: 'The request timed out. Please try again.',
  network_unavailable:
    'Live weather could not be reached. Check your connection and try again.',
  rate_limited:
    'The weather request limit has been reached. Please try again later.',
  request_rejected: 'The request could not be completed. Check your entry.',
  service_unavailable:
    'The weather service is temporarily unavailable. Please try again.',
  invalid_response:
    'The weather service returned data that could not be used.',
  storage_unavailable:
    'Browser storage is unavailable. Your last saved settings were not changed.',
  operation_cancelled: 'The previous request was cancelled.',
} as const;

function liveErrorMessage(error: {
  readonly category: string;
  readonly messageKey: keyof typeof errorCopy;
}): string {
  return error.category === 'storage'
    ? 'Live weather is unavailable because the shared request budget could not be safely coordinated.'
    : errorCopy[error.messageKey];
}

function locationLabel(location: Pick<
  LocationRef,
  'city' | 'administrativeRegion' | 'country'
>): string {
  return [
    location.city,
    location.administrativeRegion ?? 'Region unavailable',
    location.country ?? 'Country unavailable',
  ].join(', ');
}

function stateMessage<T>(state: ComponentState<T>, label: string): string {
  switch (state.status) {
    case 'unavailable':
      return `${label} is unavailable.`;
    case 'timeout':
    case 'error':
      return liveErrorMessage(state.error);
    case 'cancelled':
      return `${label} request was cancelled.`;
    default:
      return `${label} is loading.`;
  }
}

function valueOrUnavailable(value: ReactNode): ReactNode {
  return value ?? <span className="unavailable">Unavailable</span>;
}

function CurrentCard({
  state,
  retained,
  unit,
}: {
  readonly state: ComponentState<CurrentConditions>;
  readonly retained?: CurrentConditions;
  readonly unit: UnitPreference;
}) {
  const value = state.status === 'success' ? state.value : retained;
  return (
    <section className="panel current-card" aria-labelledby="current-heading">
      <h3 id="current-heading">Current conditions</h3>
      {value ? (
        <>
          {value.condition ? (
            <div className="condition">
              <ConditionIcon condition={value.condition} />
              <span>{value.condition.description}</span>
            </div>
          ) : (
            <p>Condition: <span className="unavailable">Unavailable</span></p>
          )}
          <dl className="metrics">
            <div>
              <dt>Temperature</dt>
              <dd>
                {valueOrUnavailable(
                  value.temperature === null
                    ? null
                    : formatTemperature(value.temperature, unit),
                )}
              </dd>
            </div>
            <div>
              <dt>Humidity</dt>
              <dd>
                {valueOrUnavailable(
                  value.humidityPercent === null
                    ? null
                    : `${new Intl.NumberFormat().format(value.humidityPercent)}%`,
                )}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <p className={state.status === 'error' || state.status === 'timeout' ? 'error' : ''}>
          {stateMessage(state, 'Current conditions')}
        </p>
      )}
      {retained && state.status !== 'success' ? (
        <p className="component-warning">{stateMessage(state, 'Current conditions')}</p>
      ) : null}
    </section>
  );
}

function ForecastCard({
  state,
  retained,
  unit,
}: {
  readonly state: ComponentState<readonly ForecastDay[]>;
  readonly retained?: readonly ForecastDay[];
  readonly unit: UnitPreference;
}) {
  const days = state.status === 'success' ? state.value : retained;
  return (
    <section className="panel forecast-panel" aria-labelledby="forecast-heading">
      <h3 id="forecast-heading">Next three days</h3>
      {days && days.length > 0 ? (
        <>
          <div className="forecast-grid">
            {days.map((day) => (
              <article className="forecast-day" key={day.date}>
                <h4>{formatForecastDate(day.date) ?? 'Date unavailable'}</h4>
                {day.condition ? (
                  <div className="condition">
                    <ConditionIcon condition={day.condition} />
                    <span>{day.condition.description}</span>
                  </div>
                ) : (
                  <p>Condition: <span className="unavailable">Unavailable</span></p>
                )}
                <dl>
                  <div>
                    <dt>High</dt>
                    <dd>{valueOrUnavailable(day.temperatureMax === null ? null : formatTemperature(day.temperatureMax, unit))}</dd>
                  </div>
                  <div>
                    <dt>Low</dt>
                    <dd>{valueOrUnavailable(day.temperatureMin === null ? null : formatTemperature(day.temperatureMin, unit))}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          {days.length < 3 ? (
            <p className="component-warning">
              Forecast data for {3 - days.length} remaining {days.length === 2 ? 'day is' : 'days are'} unavailable.
            </p>
          ) : null}
        </>
      ) : (
        <p className={state.status === 'error' || state.status === 'timeout' ? 'error' : ''}>
          {state.status === 'success'
            ? 'Forecast is unavailable.'
            : stateMessage(state, 'Forecast')}
        </p>
      )}
      {retained && state.status !== 'success' ? (
        <p className="component-warning">{stateMessage(state, 'Forecast')}</p>
      ) : null}
    </section>
  );
}

export function App({
  controller,
}: {
  readonly controller?: WeatherController | WeatherRequestCoordinator;
}) {
  const [state, setState] = useState<ApplicationState>(
    controller?.state ?? emptyState,
  );
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LocationRef>();
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  const [localNotice, setLocalNotice] = useState('');
  const [clockTick, setClockTick] = useState(0);
  const candidatesRef = useRef<HTMLDivElement>(null);
  const weatherHeadingRef = useRef<HTMLHeadingElement>(null);
  const favoritesHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastWeatherToken = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!controller) return;
    const unsubscribe = controller.subscribe((event) => {
      if (event.type !== 'state_changed') return;
      setState(event.state);
      if (event.state.operation) setSelected(event.state.operation.location);
    });
    void controller.initialize().then(setState);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    const becomeOnline = () => setOnline(true);
    const becomeOffline = () => setOnline(false);
    globalThis.addEventListener?.('online', becomeOnline);
    globalThis.addEventListener?.('offline', becomeOffline);
    return () => {
      globalThis.removeEventListener?.('online', becomeOnline);
      globalThis.removeEventListener?.('offline', becomeOffline);
    };
  }, []);

  useEffect(() => {
    if (state.search.status === 'candidates') {
      candidatesRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [state.search]);

  useEffect(() => {
    if (
      state.weather &&
      state.weather.requestToken !== lastWeatherToken.current
    ) {
      lastWeatherToken.current = state.weather.requestToken;
      weatherHeadingRef.current?.focus();
    }
  }, [state.weather]);

  useEffect(() => {
    const blockedUntil = state.retryBlockedUntilEpochMs;
    if (!blockedUntil || blockedUntil <= Date.now()) return;
    const timeout = globalThis.setTimeout(
      () => setClockTick((value) => value + 1),
      Math.min(blockedUntil - Date.now() + 10, 1_000),
    );
    return () => globalThis.clearTimeout(timeout);
  }, [state.retryBlockedUntilEpochMs, clockTick]);

  const isLoading =
    state.search.status === 'loading' ||
    state.deviceLocation.status === 'loading' ||
    state.operation !== undefined;
  const retryBlocked =
    (state.retryBlockedUntilEpochMs ?? 0) > Date.now();
  const displayedWeather =
    state.operation?.reason === 'unit' ? undefined : state.weather;
  const selectedIsFavorite = useMemo(() => {
    if (!selected) return false;
    const key = canonicalIdentity(selected.identity);
    return state.preferences.favorites.some(
      (favorite) => canonicalIdentity(favorite.identity) === key,
    );
  }, [selected, state.preferences.favorites]);

  const announce = !online
    ? 'Offline. Live weather requires an internet connection.'
    : state.search.status === 'loading'
      ? 'Searching for cities.'
      : state.deviceLocation.status === 'loading'
        ? 'Requesting your location.'
        : state.operation
          ? state.operation.reason === 'unit'
            ? `Fetching temperatures in ${state.operation.unit === 'celsius' ? 'Celsius' : 'Fahrenheit'}.`
            : 'Loading current conditions and forecast.'
          : localNotice ||
            (displayedWeather
              ? displayedWeather.stale
                ? 'Weather update failed. Previously retrieved weather is shown as stale.'
                : 'Weather updated.'
              : 'Weather details will appear here.');

  const requireOnline = (action: () => void) => {
    if (!online) {
      setLocalNotice('Offline. Live weather requires an internet connection.');
      return;
    }
    setLocalNotice('');
    action();
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) {
      setLocalNotice('Enter a city name.');
      return;
    }
    requireOnline(() => void controller?.search(query));
  };

  const changeUnit = (unit: UnitPreference) => {
    setLocalNotice('');
    void controller?.changeUnit(unit);
  };

  const mutateFavorite = async (
    action: () => Promise<boolean> | undefined,
    success: string,
  ) => {
    const saved = await action();
    setLocalNotice(
      saved
        ? success
        : 'The change was not saved. Your last saved favorites are unchanged.',
    );
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to weather content</a>
      <header className="app-header">
        <span aria-hidden="true" className="app-mark">W</span>
        <span>Weather</span>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>
        <div className="intro">
          <div>
            <p className="eyebrow">Local forecast</p>
            <h1>Weather at a glance</h1>
            <p>Search a city or choose your current location to see live conditions.</p>
          </div>
          <fieldset className="unit-switch">
            <legend>Temperature unit</legend>
            <label>
              <input
                checked={state.preferences.unit === 'celsius'}
                name="temperature-unit"
                onChange={() => changeUnit('celsius')}
                type="radio"
              />
              Celsius
            </label>
            <label>
              <input
                checked={state.preferences.unit === 'fahrenheit'}
                name="temperature-unit"
                onChange={() => changeUnit('fahrenheit')}
                type="radio"
              />
              Fahrenheit
            </label>
          </fieldset>
        </div>

        {!online ? (
          <div className="banner error-banner" role="alert">
            <strong>You are offline.</strong> Live weather requires an internet connection. Search and saved favorites remain available when you reconnect.
          </div>
        ) : null}
        {state.preferenceWarnings.length > 0 ? (
          <div className="banner warning-banner" role="status">
            Browser storage is unavailable or contained invalid entries. Changes may not survive this session.
          </div>
        ) : null}
        {state.preferenceError ? (
          <div className="banner error-banner" role="alert">
            {errorCopy[state.preferenceError.messageKey]}
          </div>
        ) : null}

        <section className="search-panel panel" aria-labelledby="search-heading">
          <h2 id="search-heading">Find a location</h2>
          <form className="search-form" onSubmit={submitSearch}>
            <div className="field">
              <label htmlFor="city-search">City name</label>
              <input
                autoComplete="off"
                id="city-search"
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="For example, Mumbai"
                type="search"
                value={query}
              />
            </div>
            <button disabled={state.search.status === 'loading'} type="submit">
              {state.search.status === 'loading' ? 'Searching…' : 'Search'}
            </button>
            <span className="or" aria-hidden="true">or</span>
            <button
              className="secondary"
              disabled={state.deviceLocation.status === 'loading'}
              onClick={() => requireOnline(() => void controller?.useDeviceLocation())}
              type="button"
            >
              {state.deviceLocation.status === 'loading'
                ? 'Finding location…'
                : 'Use my location'}
            </button>
          </form>
          {localNotice === 'Enter a city name.' ? (
            <p className="error" role="alert">{localNotice}</p>
          ) : null}
          {state.search.status === 'error' ? (
            <p className="error" role="alert">
              {liveErrorMessage(state.search.error)}
            </p>
          ) : null}
          {state.deviceLocation.status === 'error' ? (
            <p className="error" role="alert">
              {errorCopy[state.deviceLocation.error.messageKey]}
            </p>
          ) : null}
          {state.search.status === 'candidates' ? (
            <div className="candidate-results" ref={candidatesRef}>
              <h3>Choose a matching city</h3>
              <p>{state.search.candidates.length} matches found. Select one to load weather.</p>
              <ul>
                {state.search.candidates.map((candidate) => (
                  <li key={canonicalIdentity(candidate.identity)}>
                    <button
                      className="candidate"
                      onClick={() => {
                        setSelected(candidate);
                        void controller?.selectCandidate(candidate);
                      }}
                      type="button"
                    >
                      <strong>{candidate.city}</strong>
                      <span>{candidate.administrativeRegion ?? 'Region unavailable'}</span>
                      <span>{candidate.country ?? 'Country unavailable'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">
          {announce}
        </div>
        {isLoading && state.search.status !== 'loading' && state.deviceLocation.status !== 'loading' ? (
          <div className="loading-state" role="status">
            <span aria-hidden="true" className="spinner" />
            {announce}
          </div>
        ) : null}

        {displayedWeather && selected ? (
          <section className="weather-section" aria-labelledby="weather-heading">
            <div className="weather-title">
              <div>
                <p className="eyebrow">Selected location</p>
                <h2 id="weather-heading" ref={weatherHeadingRef} tabIndex={-1}>
                  {locationLabel(selected)}
                </h2>
                {displayedWeather.retrievedAt ? (
                  <p>Latest successful retrieval: <time>{displayedWeather.retrievedAt}</time></p>
                ) : (
                  <p>Latest successful retrieval: Unavailable</p>
                )}
              </div>
              <div className="weather-actions">
                <button
                  disabled={Boolean(state.operation)}
                  onClick={() => requireOnline(() => void controller?.refresh())}
                  type="button"
                >
                  Refresh
                </button>
                <button
                  className="secondary"
                  disabled={selectedIsFavorite}
                  onClick={() =>
                    void mutateFavorite(
                      () => controller?.addSelectedFavorite(),
                      'Location added to favorites.',
                    )
                  }
                  type="button"
                >
                  {selectedIsFavorite ? 'Saved to favorites' : 'Add to favorites'}
                </button>
              </div>
            </div>
            {displayedWeather.stale ? (
              <div className="banner stale-banner" role="alert">
                <strong>Stale weather.</strong> The latest update failed, so previously retrieved values are shown.
              </div>
            ) : null}
            <div className="weather-grid">
              <CurrentCard
                retained={displayedWeather.retained?.current}
                state={displayedWeather.current}
                unit={displayedWeather.unit}
              />
              <ForecastCard
                retained={displayedWeather.retained?.forecast}
                state={displayedWeather.forecast}
                unit={displayedWeather.unit}
              />
            </div>
            {(displayedWeather.current.status !== 'success' ||
              displayedWeather.forecast.status !== 'success') ? (
              <button
                disabled={retryBlocked || Boolean(state.operation)}
                onClick={() => requireOnline(() => void controller?.retry())}
                type="button"
              >
                {retryBlocked ? 'Retry available shortly' : 'Retry weather'}
              </button>
            ) : null}
          </section>
        ) : !isLoading ? (
          <section className="empty-state" aria-labelledby="empty-heading">
            <h2 id="empty-heading">Ready for a forecast</h2>
            <p>Weather details will appear here.</p>
          </section>
        ) : null}

        <section className="favorites panel" aria-labelledby="favorites-heading">
          <div className="section-title">
            <div>
              <p className="eyebrow">Stored in this browser</p>
              <h2 id="favorites-heading" ref={favoritesHeadingRef} tabIndex={-1}>
                Favorites
              </h2>
            </div>
            {state.preferences.favorites.length > 0 ? (
              <button
                className="text-button"
                onClick={() => {
                  void mutateFavorite(
                    () => controller?.clearFavorites(),
                    'All favorites cleared. Your temperature unit was kept.',
                  ).then(() => favoritesHeadingRef.current?.focus());
                }}
                type="button"
              >
                Clear all
              </button>
            ) : null}
          </div>
          {state.preferences.favorites.length === 0 ? (
            <p>No favorite locations saved.</p>
          ) : (
            <ul className="favorite-list">
              {state.preferences.favorites.map((favorite) => (
                <li key={canonicalIdentity(favorite.identity)}>
                  <button
                    aria-label={`View weather for ${locationLabel(favorite)}`}
                    className="favorite-select"
                    onClick={() => {
                      setSelected({
                        ...favorite,
                        timezone: null,
                        elevationMetres: null,
                      });
                      requireOnline(() => void controller?.selectFavorite(favorite));
                    }}
                    type="button"
                  >
                    <strong>{favorite.city}</strong>
                    <span>{[favorite.administrativeRegion ?? 'Region unavailable', favorite.country ?? 'Country unavailable'].join(', ')}</span>
                  </button>
                  <button
                    aria-label={`Remove ${favorite.city} from favorites`}
                    className="remove-button"
                    onClick={() => {
                      void mutateFavorite(
                        () => controller?.removeFavorite(favorite.identity),
                        `${favorite.city} removed from favorites.`,
                      ).then(() => favoritesHeadingRef.current?.focus());
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <details className="privacy panel">
          <summary>Privacy and storage</summary>
          <p>
            We request your device location only after you choose “Use my location”.
            If allowed, your coordinates are sent to Open-Meteo to retrieve weather.
            Favorites and your unit preference are stored only in this browser.
            Weather responses, permission choices, and search history are not saved.
          </p>
        </details>
      </main>
      <footer className="app-footer">
        <p>This online-only app has no offline weather cache and sends no telemetry.</p>
        <a href="https://open-meteo.com/" rel="noreferrer">
          Weather data by Open-Meteo
        </a>
      </footer>
    </div>
  );
}
