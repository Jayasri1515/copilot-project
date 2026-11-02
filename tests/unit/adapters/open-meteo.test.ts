import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_VARIABLES,
  DAILY_VARIABLES,
  FORECAST_ENDPOINT,
  GEOCODING_ENDPOINT,
  OpenMeteoGeocodingAdapter,
  OpenMeteoWeatherAdapter,
  type BudgetReservationPort,
} from '../../../src/adapters/open-meteo';
import type { Clock, RandomSource, Timer } from '../../../src/application/ports/Clock';
import { RetryPolicy } from '../../../src/application/weather/retryPolicy';
import { createDeviceIdentity, createSearchIdentity } from '../../../src/domain/identity';
import type { PortResult } from '../../../src/domain/models/results';
import { server } from '../../msw/server';
import {
  ambiguousGeocodingResponse,
  partialGeocodingResponse,
} from '../../fixtures/geocoding/adapter-contracts';
import { geocodingContractFixtures } from '../../fixtures/geocoding/contracts';
import {
  fahrenheitWeatherResponse,
  partialWeatherResponse,
} from '../../fixtures/weather/adapter-contracts';
import { validWeatherFixture } from '../../fixtures/weather/contracts';

class RealTimer implements Timer {
  set(delayMs: number, callback: () => void): unknown {
    return setTimeout(callback, delayMs);
  }
  clear(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

const clock: Clock = { nowEpochMs: () => 1_000 };
const random: RandomSource = { next: () => 0 };

function dependencies(overrides: {
  readonly budget?: BudgetReservationPort;
  readonly fetch?: typeof fetch;
} = {}) {
  return {
    clock,
    timer: new RealTimer(),
    budget: overrides.budget ?? {
      reserve: vi.fn(async () => ({
        kind: 'success',
        value: {},
        metadata: {},
      } as PortResult<unknown>)),
    },
    retryPolicy: new RetryPolicy({
      clock,
      timer: new RealTimer(),
      random,
    }),
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
  };
}

describe('OpenMeteoGeocodingAdapter', () => {
  it('uses only the verified query contract and maps ambiguous results', async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(GEOCODING_ENDPOINT, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(ambiguousGeocodingResponse);
      }),
    );
    const result = await new OpenMeteoGeocodingAdapter(dependencies())
      .search('  São Paulo & South  ');

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.identity.namespace).toBe('open-meteo-search');
    expect(result.value[0]?.identity.latitude.decimal).toBe('19.07283');
    expect(Object.fromEntries(query!)).toEqual({
      name: 'São Paulo & South',
      count: '20',
      language: 'en',
      format: 'json',
    });
  });

  it('returns not-found for an empty provider result', async () => {
    server.use(http.get(GEOCODING_ENDPOINT, () =>
      HttpResponse.json(geocodingContractFixtures.empty)));
    const result = await new OpenMeteoGeocodingAdapter(dependencies()).search('Nowhere');
    expect(result).toMatchObject({
      kind: 'failure',
      error: { category: 'not_found', retryable: false },
    });
  });

  it('isolates invalid candidates and rejects invalid input without dispatch', async () => {
    let dispatched = 0;
    server.use(http.get(GEOCODING_ENDPOINT, () => {
      dispatched++;
      return HttpResponse.json(partialGeocodingResponse);
    }));
    const adapter = new OpenMeteoGeocodingAdapter(dependencies());
    const partial = await adapter.search('Mumbai');
    expect(partial).toMatchObject({
      kind: 'partial',
      value: [{ city: 'Mumbai' }],
      unavailable: ['invalid_candidates'],
    });
    const rejected = await adapter.search(' '.repeat(4));
    expect(rejected).toMatchObject({
      kind: 'failure',
      error: { category: 'validation' },
    });
    expect(dispatched).toBe(1);
  });
});

describe('OpenMeteoWeatherAdapter', () => {
  it('preserves coordinate precision and sends the exact forecast query', async () => {
    let query: URLSearchParams | undefined;
    server.use(http.get(FORECAST_ENDPOINT, ({ request }) => {
      query = new URL(request.url).searchParams;
      return HttpResponse.json(fahrenheitWeatherResponse);
    }));
    const identity = createSearchIdentity({
      providerId: 1,
      latitude: { decimal: '19.072830' },
      longitude: { decimal: '72.882610' },
    })!;
    const result = await new OpenMeteoWeatherAdapter(dependencies()).getWeather({
      identity,
      unit: 'fahrenheit',
    });
    expect(result.kind).toBe('success');
    expect(Object.fromEntries(query!)).toEqual({
      latitude: '19.072830',
      longitude: '72.882610',
      current: CURRENT_VARIABLES,
      daily: DAILY_VARIABLES,
      temperature_unit: 'fahrenheit',
      timezone: 'auto',
      forecast_days: '4',
    });
  });

  it('maps timezone, current, daily, WMO unknown, and partial values', async () => {
    server.use(http.get(FORECAST_ENDPOINT, () => HttpResponse.json(partialWeatherResponse)));
    const identity = createDeviceIdentity({ latitude: 19, longitude: 72 })!;
    const result = await new OpenMeteoWeatherAdapter(dependencies()).getWeather({
      identity,
      unit: 'celsius',
    });
    expect(result).toMatchObject({
      kind: 'partial',
      value: {
        timezone: 'Asia/Kolkata',
        current: { temperature: null, humidityPercent: 70, condition: null },
        forecast: [
          { date: '2026-10-27', temperatureMin: null },
          { condition: { code: 4, description: 'Unknown conditions', iconKey: 'unknown' } },
        ],
      },
    });
  });

  it.each([
    ['malformed', HttpResponse.text('{', { headers: { 'content-type': 'application/json' } })],
    ['wrong MIME', HttpResponse.text('{}', { headers: { 'content-type': 'text/plain' } })],
    ['missing fields', HttpResponse.json({ latitude: 1 })],
    ['oversized', HttpResponse.text('x'.repeat(1_048_577), {
      headers: { 'content-type': 'application/json' },
    })],
  ])('rejects %s responses', async (_name, response) => {
    server.use(http.get(FORECAST_ENDPOINT, () => response));
    const identity = createDeviceIdentity({ latitude: 1, longitude: 2 })!;
    const result = await new OpenMeteoWeatherAdapter(dependencies()).getWeather({
      identity,
      unit: 'celsius',
    });
    expect(result).toMatchObject({
      kind: 'failure',
      error: { category: 'validation', retryable: false },
    });
  });

  it('classifies HTTP errors and exposes Retry-After metadata', async () => {
    let attempts = 0;
    server.use(http.get(FORECAST_ENDPOINT, () => {
      attempts++;
      return new HttpResponse(null, {
        status: 429,
        headers: { 'retry-after': '30' },
      });
    }));
    const identity = createDeviceIdentity({ latitude: 1, longitude: 2 })!;
    const result = await new OpenMeteoWeatherAdapter(dependencies()).getWeather({
      identity,
      unit: 'celsius',
    });
    expect(result).toMatchObject({
      kind: 'failure',
      error: { category: 'rate_limited', retryAfterMs: 30_000 },
    });
    expect(attempts).toBe(1);
  });

  it('maps network failure after one retry and reserves before each attempt', async () => {
    const reserve = vi.fn(async () => ({
      kind: 'success',
      value: {},
      metadata: {},
    } as PortResult<unknown>));
    let attempts = 0;
    server.use(http.get(FORECAST_ENDPOINT, () => {
      attempts++;
      return HttpResponse.error();
    }));
    const identity = createDeviceIdentity({ latitude: 1, longitude: 2 })!;
    const result = await new OpenMeteoWeatherAdapter(
      dependencies({ budget: { reserve } }),
    ).getWeather({ identity, unit: 'celsius' });
    expect(result).toMatchObject({
      kind: 'failure',
      error: { category: 'network', retryable: true },
    });
    expect(attempts).toBe(2);
    expect(reserve).toHaveBeenCalledTimes(2);
  });

  it.each([
    [400, 'http_client', false],
    [503, 'http_server', true],
  ])('maps HTTP %s to %s', async (status, category, retryable) => {
    server.use(http.get(FORECAST_ENDPOINT, () =>
      new HttpResponse(null, { status })));
    const identity = createDeviceIdentity({ latitude: 1, longitude: 2 })!;
    const result = await new OpenMeteoWeatherAdapter(dependencies()).getWeather({
      identity,
      unit: 'celsius',
    });
    expect(result).toMatchObject({
      kind: 'failure',
      error: { category, retryable },
    });
  });

  it('applies a ten-second timeout to each attempt', async () => {
    vi.useFakeTimers();
    const neverFetch = vi.fn(() => new Promise<Response>(() => undefined)) as
      unknown as typeof fetch;
    const identity = createDeviceIdentity({ latitude: 1, longitude: 2 })!;
    const promise = new OpenMeteoWeatherAdapter(
      dependencies({ fetch: neverFetch }),
    ).getWeather({ identity, unit: 'celsius' });
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toMatchObject({
      kind: 'failure',
      error: { category: 'timeout', retryable: true },
    });
    expect(neverFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('rejects forged IDs and coordinates before budget reservation', async () => {
    const reserve = vi.fn();
    const adapter = new OpenMeteoWeatherAdapter(
      dependencies({ budget: { reserve } }),
    );
    const invalidIdentity = {
      namespace: 'open-meteo-search',
      providerId: -1,
      latitude: { value: 91, decimal: '91' },
      longitude: { value: 2, decimal: '2' },
    };
    const result = await adapter.getWeather({
      identity: invalidIdentity as never,
      unit: 'celsius',
    });
    expect(result).toMatchObject({
      kind: 'failure',
      error: { category: 'validation' },
    });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('honors abort and ignores a late fetch result', async () => {
    let finish!: (value: Response) => void;
    const delayedFetch = vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    })) as unknown as typeof fetch;
    const controller = new AbortController();
    const identity = createDeviceIdentity({ latitude: 1, longitude: 2 })!;
    const promise = new OpenMeteoWeatherAdapter(
      dependencies({ fetch: delayedFetch }),
    ).getWeather({ identity, unit: 'celsius' }, { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const result = await promise;
    finish(HttpResponse.json(validWeatherFixture));
    expect(result).toMatchObject({
      kind: 'failure',
      error: { category: 'cancelled' },
    });
  });
});
