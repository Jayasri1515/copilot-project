import type {
  DeviceLocationPort,
  RequestOptions,
} from '../../application/ports';
import type { Timer, TimerHandle } from '../../application/ports/Clock';
import { operationError } from '../../domain/errors';
import { createDeviceIdentity } from '../../domain/identity';
import type { DeviceLocationIdentity } from '../../domain/identity';
import type { PortResult } from '../../domain/models/results';

export const GEOLOCATION_TIMEOUT_MS = 10_000;

export interface GeolocationLike {
  getCurrentPosition(
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): void;
}

export class BrowserGeolocationAdapter implements DeviceLocationPort {
  readonly #geolocation: GeolocationLike | undefined;
  readonly #timer: Timer;

  constructor(dependencies: {
    readonly timer: Timer;
    readonly geolocation?: GeolocationLike;
  }) {
    this.#timer = dependencies.timer;
    this.#geolocation =
      dependencies.geolocation ?? globalThis.navigator?.geolocation;
  }

  locate(
    options?: RequestOptions,
  ): Promise<PortResult<DeviceLocationIdentity>> {
    if (options?.signal?.aborted) {
      return Promise.resolve(this.#cancelled());
    }
    if (!this.#geolocation) {
      return Promise.resolve({
        kind: 'failure',
        error: operationError('unavailable', false, 'location_unavailable'),
      });
    }
    const geolocation = this.#geolocation;

    return new Promise((resolve) => {
      let settled = false;
      let timeout: TimerHandle;
      const finish = (result: PortResult<DeviceLocationIdentity>) => {
        if (settled) return;
        settled = true;
        this.#timer.clear(timeout);
        options?.signal?.removeEventListener('abort', cancel);
        resolve(result);
      };
      const cancel = () => finish(this.#cancelled());

      timeout = this.#timer.set(GEOLOCATION_TIMEOUT_MS, () => {
        finish({
          kind: 'failure',
          error: operationError('timeout', true, 'request_timed_out'),
        });
      });
      options?.signal?.addEventListener('abort', cancel, { once: true });

      try {
        geolocation.getCurrentPosition(
          (position) => {
            const identity = createDeviceIdentity({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
            finish(
              identity
                ? { kind: 'success', value: identity, metadata: {} }
                : {
                    kind: 'failure',
                    error: operationError(
                      'validation',
                      false,
                      'invalid_response',
                    ),
                  },
            );
          },
          (error) => {
            if (error.code === 1) {
              finish({
                kind: 'failure',
                error: operationError(
                  'permission_denied',
                  false,
                  'location_permission_denied',
                ),
              });
            } else if (error.code === 3) {
              finish({
                kind: 'failure',
                error: operationError('timeout', true, 'request_timed_out'),
              });
            } else {
              finish({
                kind: 'failure',
                error: operationError(
                  'unavailable',
                  true,
                  'location_unavailable',
                ),
              });
            }
          },
          {
            enableHighAccuracy: false,
            maximumAge: 0,
            timeout: GEOLOCATION_TIMEOUT_MS,
          },
        );
      } catch {
        finish({
          kind: 'failure',
          error: operationError('unavailable', true, 'location_unavailable'),
        });
      }
    });
  }

  #cancelled(): PortResult<never> {
    return {
      kind: 'failure',
      error: operationError('cancelled', false, 'operation_cancelled'),
    };
  }
}
