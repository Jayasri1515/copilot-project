import { describe, expect, it, vi } from 'vitest';
import {
  BrowserGeolocationAdapter,
  GEOLOCATION_TIMEOUT_MS,
  type GeolocationLike,
} from '../../../src/adapters/geolocation';
import type { Timer } from '../../../src/application/ports/Clock';

function geolocationHarness() {
  let success: PositionCallback | undefined;
  let failure: PositionErrorCallback | undefined;
  const getCurrentPosition = vi.fn((
    next: PositionCallback,
    error?: PositionErrorCallback | null,
  ) => {
    success = next;
    failure = error ?? undefined;
  });
  return {
    geolocation: { getCurrentPosition } as GeolocationLike,
    get success() { return success!; },
    get failure() { return failure!; },
    getCurrentPosition,
  };
}

describe('BrowserGeolocationAdapter', () => {
  it('does not invoke geolocation until locate is explicitly called', () => {
    const harness = geolocationHarness();
    new BrowserGeolocationAdapter({
      geolocation: harness.geolocation,
      timer: {
        set: vi.fn(),
        clear: vi.fn(),
      },
    });
    expect(harness.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('maps successful coordinates to device identity without reverse geocoding', async () => {
    const harness = geolocationHarness();
    const adapter = new BrowserGeolocationAdapter({
      geolocation: harness.geolocation,
      timer: {
        set: () => 1,
        clear: vi.fn(),
      },
    });
    const promise = adapter.locate();
    harness.success({ coords: { latitude: 12.3456, longitude: -45.6789 } } as GeolocationPosition);
    await expect(promise).resolves.toMatchObject({
      kind: 'success',
      value: {
        namespace: 'device-coordinates',
        latitude: { decimal: '12.3456' },
        longitude: { decimal: '-45.6789' },
      },
    });
    expect(harness.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 },
    );
  });

  it.each([
    [1, 'permission_denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps browser error %s distinctly', async (code, category) => {
    const harness = geolocationHarness();
    const adapter = new BrowserGeolocationAdapter({
      geolocation: harness.geolocation,
      timer: { set: () => 1, clear: vi.fn() },
    });
    const promise = adapter.locate();
    harness.failure({ code } as GeolocationPositionError);
    await expect(promise).resolves.toMatchObject({
      kind: 'failure',
      error: { category },
    });
  });

  it('times out at ten seconds and rejects a late callback', async () => {
    vi.useFakeTimers();
    const harness = geolocationHarness();
    const timer: Timer = {
      set: (delay, callback) => setTimeout(callback, delay),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    const adapter = new BrowserGeolocationAdapter({
      geolocation: harness.geolocation,
      timer,
    });
    const promise = adapter.locate();
    await vi.advanceTimersByTimeAsync(GEOLOCATION_TIMEOUT_MS);
    const result = await promise;
    harness.success({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition);
    expect(result).toMatchObject({
      kind: 'failure',
      error: { category: 'timeout' },
    });
    vi.useRealTimers();
  });

  it('cancels and rejects invalid coordinates', async () => {
    const harness = geolocationHarness();
    const adapter = new BrowserGeolocationAdapter({
      geolocation: harness.geolocation,
      timer: { set: () => 1, clear: vi.fn() },
    });
    const controller = new AbortController();
    const cancelled = adapter.locate({ signal: controller.signal });
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({
      kind: 'failure',
      error: { category: 'cancelled' },
    });

    const invalid = adapter.locate();
    harness.success({ coords: { latitude: 91, longitude: 2 } } as GeolocationPosition);
    await expect(invalid).resolves.toMatchObject({
      kind: 'failure',
      error: { category: 'validation' },
    });
  });
});
