import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApplicationEvent, ApplicationState } from '../../src/application/state';
import { operationError } from '../../src/domain/errors';
import { createSearchIdentity } from '../../src/domain/identity';
import type { LocationRef } from '../../src/domain/models';
import {
  App,
  type WeatherController,
} from '../../src/presentation/app/App';

const identity = createSearchIdentity({
  providerId: 11,
  latitude: 19.076,
  longitude: 72.8777,
})!;
const location: LocationRef = Object.freeze({
  identity,
  city: 'Mumbai',
  administrativeRegion: 'Maharashtra',
  country: 'India',
  timezone: 'Asia/Kolkata',
  elevationMetres: null,
});
const secondLocation: LocationRef = Object.freeze({
  ...location,
  identity: createSearchIdentity({
    providerId: 12,
    latitude: 19.2,
    longitude: 72.9,
  })!,
  administrativeRegion: null,
  country: null,
});

const baseState = (): ApplicationState => ({
  preferences: { version: 1, unit: 'celsius', favorites: [] },
  preferenceWarnings: [],
  search: { status: 'idle' },
  deviceLocation: { status: 'idle' },
});

function controllerHarness(initial = baseState()) {
  let state = initial;
  const listeners = new Set<(event: ApplicationEvent) => void>();
  const controller: WeatherController = {
    get state() {
      return state;
    },
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    initialize: vi.fn(async () => state),
    search: vi.fn(async () => undefined),
    selectCandidate: vi.fn(async () => undefined),
    useDeviceLocation: vi.fn(async () => undefined),
    selectFavorite: vi.fn(async () => undefined),
    changeUnit: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    addSelectedFavorite: vi.fn(async () => true),
    removeFavorite: vi.fn(async () => true),
    clearFavorites: vi.fn(async () => true),
    dispose: vi.fn(),
  };
  return {
    controller,
    emit(next: ApplicationState) {
      state = next;
      act(() => {
        for (const listener of listeners) {
          listener({ type: 'state_changed', state: next });
        }
      });
    },
  };
}

describe('accessible weather presentation', () => {
  it('renders an English empty shell, explicit location action, privacy notice, and attribution without startup side effects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const geolocation = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: geolocation },
    });
    const harness = controllerHarness();

    render(<App controller={harness.controller} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Weather at a glance' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'City name' })).toHaveAttribute('maxlength', '200');
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
    expect(screen.getByRole('group', { name: 'Temperature unit' })).toBeInTheDocument();
    expect(screen.getAllByText('Weather details will appear here.')).toHaveLength(2);
    fireEvent.click(screen.getByText('Privacy and storage'));
    expect(screen.getByText(/coordinates are sent to Open-Meteo/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Weather data by Open-Meteo' })).toHaveAttribute('href', 'https://open-meteo.com/');
    await waitFor(() => expect(harness.controller.initialize).toHaveBeenCalled());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(geolocation).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('validates empty search locally and submits trimmed non-empty search', () => {
    const harness = controllerHarness();
    render(<App controller={harness.controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a city name.');
    expect(harness.controller.search).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('searchbox', { name: 'City name' }), {
      target: { value: '  Mumbai  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(harness.controller.search).toHaveBeenCalledWith('  Mumbai  ');
  });

  it('announces ambiguous candidates, marks missing fields unavailable, moves focus, and waits for selection', () => {
    const harness = controllerHarness();
    render(<App controller={harness.controller} />);
    harness.emit({
      ...baseState(),
      search: {
        status: 'candidates',
        token: 1,
        candidates: [location, secondLocation],
      },
    });

    expect(screen.getByRole('heading', { name: 'Choose a matching city' })).toBeInTheDocument();
    const candidates = screen.getAllByRole('button', { name: /Mumbai/ });
    expect(candidates[0]).toHaveFocus();
    expect(screen.getByText('Region unavailable')).toBeInTheDocument();
    expect(screen.getByText('Country unavailable')).toBeInTheDocument();
    expect(harness.controller.selectCandidate).not.toHaveBeenCalled();

    fireEvent.click(candidates[1]);
    expect(harness.controller.selectCandidate).toHaveBeenCalledWith(secondLocation);
  });

  it('renders locale-formatted successful and partial weather with local SVG alternatives and retrieval time', () => {
    const harness = controllerHarness();
    render(<App controller={harness.controller} />);
    harness.emit({
      ...baseState(),
      operation: {
        status: 'loading',
        token: 2,
        reason: 'selection',
        location,
        unit: 'celsius',
      },
    });
    harness.emit({
      ...baseState(),
      weather: {
        requestToken: 2,
        identity,
        unit: 'celsius',
        stale: false,
        retrievedAt: '27 Oct 2026, 4:30 pm',
        current: {
          status: 'success',
          value: {
            temperature: 24.5,
            humidityPercent: null,
            condition: { code: 1, description: 'Mainly clear', iconKey: 'mainly-clear' },
          },
        },
        forecast: {
          status: 'success',
          value: [
            {
              date: '2026-10-28',
              temperatureMax: 30.4,
              temperatureMin: 20.5,
              condition: { code: 61, description: 'Slight rain', iconKey: 'rain-slight' },
            },
          ],
        },
      },
    });

    const heading = screen.getByRole('heading', { name: 'Mumbai, Maharashtra, India' });
    expect(heading).toHaveFocus();
    expect(screen.getByText('25 °C')).toBeInTheDocument();
    expect(screen.getByText('Humidity').nextElementSibling).toHaveTextContent('Unavailable');
    expect(screen.getByRole('img', { name: 'Mainly clear condition icon' }).getAttribute('src')).not.toMatch(/^https?:/);
    expect(screen.getByRole('img', { name: 'Slight rain condition icon' }).getAttribute('src')).not.toMatch(/^https?:/);
    expect(screen.getByText(/Forecast data for 2 remaining days are unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Latest successful retrieval/)).toHaveTextContent('27 Oct 2026');

    harness.emit({
      ...harness.controller.state,
      preferences: { version: 1, unit: 'fahrenheit', favorites: [] },
      operation: {
        status: 'loading',
        token: 3,
        reason: 'unit',
        location,
        unit: 'fahrenheit',
      },
    });
    expect(screen.queryByText('25 °C')).not.toBeInTheDocument();
    expect(screen.getAllByText('Fetching temperatures in Fahrenheit.')).toHaveLength(2);
  });

  it.each([
    ['not found', { search: { status: 'error', token: 1, error: operationError('not_found', false, 'city_not_found') } }],
    ['permission denied', { deviceLocation: { status: 'error', token: 1, error: operationError('permission_denied', false, 'location_permission_denied') } }],
    ['external failure', { search: { status: 'error', token: 1, error: operationError('http_server', true, 'service_unavailable') } }],
  ] as const)('presents the %s error as an alert while keeping search available', (_name, change) => {
    const harness = controllerHarness();
    render(<App controller={harness.controller} />);
    harness.emit({ ...baseState(), ...change } as ApplicationState);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'City name' })).toBeEnabled();
  });

  it('shows stale retained data, rate-limit retry state, and invokes refresh and retry', () => {
    const harness = controllerHarness();
    render(<App controller={harness.controller} />);
    harness.emit({
      ...baseState(),
      operation: { status: 'loading', token: 3, reason: 'selection', location, unit: 'celsius' },
    });
    harness.emit({
      ...baseState(),
      weather: {
        requestToken: 3,
        identity,
        unit: 'celsius',
        stale: true,
        current: {
          status: 'error',
          error: operationError('rate_limited', true, 'rate_limited', 5_000),
        },
        forecast: {
          status: 'unavailable',
        },
        retained: {
          current: { temperature: 20, humidityPercent: 50, condition: null },
        },
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Stale weather');
    expect(screen.getByText('20 °C')).toBeInTheDocument();
    expect(screen.getByText(/request limit has been reached/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry weather' }));
    expect(harness.controller.refresh).toHaveBeenCalled();
    expect(harness.controller.retry).toHaveBeenCalled();
  });

  it('supports unit refetch state and favorite add, select, remove, and clear controls', async () => {
    const favorite = {
      identity,
      city: 'Mumbai',
      administrativeRegion: 'Maharashtra',
      country: 'India',
    };
    const harness = controllerHarness({
      ...baseState(),
      preferences: { version: 1, unit: 'celsius', favorites: [favorite] },
    });
    render(<App controller={harness.controller} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Fahrenheit' }));
    expect(harness.controller.changeUnit).toHaveBeenCalledWith('fahrenheit');
    fireEvent.click(screen.getByRole('button', { name: 'View weather for Mumbai, Maharashtra, India' }));
    expect(harness.controller.selectFavorite).toHaveBeenCalledWith(favorite);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mumbai from favorites' }));
    await waitFor(() => expect(harness.controller.removeFavorite).toHaveBeenCalledWith(identity));
    expect(screen.getByRole('heading', { name: 'Favorites' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(harness.controller.clearFavorites).toHaveBeenCalled());
  });

  it('shows persistent storage, offline, and budget-unavailable messages without hiding local controls', () => {
    const harness = controllerHarness({
      ...baseState(),
      preferenceWarnings: ['persistent_storage_unavailable'],
      preferenceError: operationError('storage', false, 'storage_unavailable'),
    });
    render(<App controller={harness.controller} />);
    expect(screen.getByText(/Changes may not survive this session/)).toBeInTheDocument();
    expect(screen.getByText(/last saved settings were not changed/)).toBeInTheDocument();

    act(() => globalThis.dispatchEvent(new Event('offline')));
    expect(screen.getByText('You are offline.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(harness.controller.useDeviceLocation).not.toHaveBeenCalled();
    expect(screen.getByRole('searchbox', { name: 'City name' })).toBeEnabled();
  });

  it('distinguishes fail-closed request-budget storage failure from preference storage failure', () => {
    const harness = controllerHarness();
    render(<App controller={harness.controller} />);
    harness.emit({
      ...baseState(),
      search: {
        status: 'error',
        token: 4,
        error: operationError('storage', false, 'storage_unavailable'),
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'shared request budget could not be safely coordinated',
    );
  });
});
