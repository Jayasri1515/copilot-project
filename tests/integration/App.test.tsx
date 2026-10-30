import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryPreferencesRepository } from '../../src/adapters/storage';
import { FavoritesPreferencesService } from '../../src/application/favorites';
import type {
  ClockPort,
  DeviceLocationPort,
  LocationResolutionPort,
} from '../../src/application/ports';
import {
  WeatherRequestCoordinator,
  type WeatherComponentLoader,
  type WeatherComponentOperation,
} from '../../src/application/weather';
import { operationError } from '../../src/domain/errors';
import { createSearchIdentity } from '../../src/domain/identity';
import type {
  CurrentConditions,
  ForecastDay,
  LocationRef,
} from '../../src/domain/models';
import type { PortResult } from '../../src/domain/models/results';
import { App } from '../../src/presentation/app/App';

const identity = createSearchIdentity({
  providerId: 101,
  latitude: 51.5072,
  longitude: -0.1276,
})!;
const london: LocationRef = {
  identity,
  city: 'London',
  administrativeRegion: 'England',
  country: 'United Kingdom',
  timezone: 'Europe/London',
  elevationMetres: null,
};
const metadata = { retrievedAtEpochMs: Date.UTC(2026, 9, 27, 10) };
const success = <T,>(value: T): PortResult<T> => ({
  kind: 'success',
  value,
  metadata,
});
const current: CurrentConditions = {
  temperature: 12.5,
  humidityPercent: 72,
  condition: { code: 3, description: 'Overcast', iconKey: 'overcast' },
};
const forecast: readonly ForecastDay[] = [
  {
    date: '2026-10-28',
    temperatureMax: 15,
    temperatureMin: 8,
    condition: { code: 61, description: 'Slight rain', iconKey: 'rain-slight' },
  },
];

class IntegrationClock implements ClockPort {
  nowEpochMs() {
    return metadata.retrievedAtEpochMs;
  }
  delay(_milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    });
  }
}

class QueueLoader implements WeatherComponentLoader {
  readonly operations: WeatherComponentOperation[] = [];
  readonly units: string[] = [];
  start(
    request: { readonly unit: string },
  ): WeatherComponentOperation {
    this.units.push(request.unit);
    const operation = this.operations.shift();
    if (!operation) throw new Error('No queued operation');
    return operation;
  }
}

function pair(
  currentResult: PortResult<CurrentConditions | null> = success(current),
): WeatherComponentOperation {
  return {
    current: Promise.resolve(currentResult),
    forecast: Promise.resolve(
      success({ value: forecast, timezone: 'Europe/London' }),
    ),
  };
}

const deniedLocation = async (): Promise<PortResult<never>> => ({
  kind: 'failure',
  error: operationError(
    'permission_denied',
    false,
    'location_permission_denied',
  ),
});

function integrationHarness(options: {
  device?: DeviceLocationPort;
} = {}) {
  const loader = new QueueLoader();
  const locations: LocationResolutionPort = {
    search: vi.fn(async () => success([london])),
  };
  const device: DeviceLocationPort =
    options.device ?? {
      locate: vi.fn(deniedLocation),
    };
  const preferences = new FavoritesPreferencesService(
    new MemoryPreferencesRepository(),
  );
  const controller = new WeatherRequestCoordinator({
    locations,
    deviceLocation: device,
    componentLoader: loader,
    preferences,
    clock: new IntegrationClock(),
  });
  return { controller, loader, locations, device };
}

describe('presentation and application integration', () => {
  it('connects search, weather, favorite, unit refetch, refresh failure, stale retention, and retry', async () => {
    const { controller, loader, locations, device } = integrationHarness();
    loader.operations.push(pair(), pair(), pair({
      kind: 'failure',
      error: operationError('network', true, 'network_unavailable'),
    }), pair());
    render(<App controller={controller} />);

    expect(device.locate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('searchbox', { name: 'City name' }), {
      target: { value: 'London' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByRole('heading', {
      name: 'London, England, United Kingdom',
    });
    expect(locations.search).toHaveBeenCalledWith(
      'London',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText('13 °C')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));
    await screen.findByRole('button', {
      name: 'View weather for London, England, United Kingdom',
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Fahrenheit' }));
    await waitFor(() => expect(loader.units).toEqual(['celsius', 'fahrenheit']));
    expect(screen.getByText('13 °F')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText(/Stale weather/);
    expect(screen.getByText('13 °F')).toBeInTheDocument();
    expect(screen.getByText(/Live weather could not be reached/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry weather' }));
    await waitFor(() => expect(loader.units).toHaveLength(4));
  });

  it('does not request geolocation until the explicit action and presents permission denial', async () => {
    const device: DeviceLocationPort = {
      locate: vi.fn(deniedLocation),
    };
    const { controller } = integrationHarness({ device });
    render(<App controller={controller} />);

    expect(device.locate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Location permission was denied',
    );
    expect(device.locate).toHaveBeenCalledOnce();
    expect(screen.getByRole('searchbox', { name: 'City name' })).toBeEnabled();
  });
});
