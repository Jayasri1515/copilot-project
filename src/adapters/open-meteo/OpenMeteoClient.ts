import type { RequestOptions } from '../../application/ports';
import type { Clock } from '../../application/ports/Clock';
import {
  type AttemptFailure,
  type RetryPolicy,
  type RetryResult,
} from '../../application/weather/retryPolicy';
import { operationError } from '../../domain/errors';
import type { PortResult } from '../../domain/models/results';
import {
  parseJsonContract,
  type ValidationResult,
} from '../../domain/validation/contracts';
import { VALIDATION_LIMITS } from '../../domain/validation/limits';

export const OPEN_METEO_SCOPE = 'open-meteo';

export interface BudgetReservationPort {
  reserve(scope: string, options?: RequestOptions): Promise<PortResult<unknown>>;
}

export interface OpenMeteoDependencies {
  readonly budget: BudgetReservationPort;
  readonly retryPolicy: RetryPolicy;
  readonly clock: Clock;
  readonly fetch?: typeof globalThis.fetch;
}

type ResponseMapper<T> = (
  value: unknown,
  metadata: { readonly status: number; readonly retrievedAtEpochMs: number },
) => PortResult<T>;

function validationFailure(): PortResult<never> {
  return {
    kind: 'failure',
    error: operationError('validation', false, 'invalid_response'),
  };
}

async function readBoundedJson(
  response: Response,
): Promise<ValidationResult<unknown>> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > VALIDATION_LIMITS.providerBodyBytes
    ) {
      return { valid: false, reason: 'body_too_large' };
    }
  }

  const contentType = response.headers.get('content-type');
  if (
    contentType === null ||
    !/^\s*application\/json(?:\s*;|$)/i.test(contentType)
  ) {
    return { valid: false, reason: 'content_type' };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.text();
    return parseJsonContract(body);
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > VALIDATION_LIMITS.providerBodyBytes) {
        await reader.cancel();
        return { valid: false, reason: 'body_too_large' };
      }
      chunks.push(next.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      return { valid: false, reason: 'invalid_utf8' };
    }
    return parseJsonContract(decoded);
  } finally {
    reader.releaseLock();
  }
}

function classifyFailure<T>(
  result: Exclude<RetryResult<T>, { readonly ok: true }>,
  nowEpochMs: number,
): PortResult<never> {
  const failure = result.failure;
  const retryAfterMs =
    result.retryAllowedAtEpochMs === undefined
      ? undefined
      : Math.max(0, result.retryAllowedAtEpochMs - nowEpochMs);
  if (failure.kind === 'cancelled') {
    return {
      kind: 'failure',
      error: operationError('cancelled', false, 'operation_cancelled'),
    };
  }
  if (failure.kind === 'timeout') {
    return {
      kind: 'failure',
      error: operationError('timeout', true, 'request_timed_out'),
    };
  }
  if (failure.kind === 'network') {
    return {
      kind: 'failure',
      error: operationError('network', true, 'network_unavailable'),
    };
  }
  if (failure.kind === 'validation') return validationFailure();

  if (failure.status === 429) {
    return {
      kind: 'failure',
      error: operationError(
        'rate_limited',
        true,
        'rate_limited',
        retryAfterMs,
      ),
    };
  }
  if (failure.status >= 500) {
    return {
      kind: 'failure',
      error: operationError(
        'http_server',
        true,
        'service_unavailable',
        retryAfterMs,
      ),
    };
  }
  return {
    kind: 'failure',
    error: operationError(
      'http_client',
      failure.status === 408,
      'request_rejected',
      retryAfterMs,
    ),
  };
}

export class OpenMeteoClient {
  readonly #budget: BudgetReservationPort;
  readonly #retryPolicy: RetryPolicy;
  readonly #clock: Clock;
  readonly #fetch: typeof globalThis.fetch;

  constructor(dependencies: OpenMeteoDependencies) {
    this.#budget = dependencies.budget;
    this.#retryPolicy = dependencies.retryPolicy;
    this.#clock = dependencies.clock;
    this.#fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async get<T>(
    url: URL,
    mapper: ResponseMapper<T>,
    options?: RequestOptions,
  ): Promise<PortResult<T>> {
    const execution = await this.#retryPolicy.execute(
      { scope: OPEN_METEO_SCOPE, signal: options?.signal },
      async ({ signal }) => {
        let reservation: PortResult<unknown>;
        try {
          reservation = await this.#budget.reserve(OPEN_METEO_SCOPE, {
            signal,
          });
        } catch {
          reservation = {
            kind: 'failure',
            error: operationError('storage', false, 'storage_unavailable'),
          };
        }
        if (reservation.kind === 'failure') {
          // A denied reservation is already a provider-neutral terminal result.
          return { ok: true, value: reservation as PortResult<T> };
        }
        if (reservation.kind !== 'success') {
          return {
            ok: true,
            value: {
              kind: 'failure',
              error: operationError('storage', false, 'storage_unavailable'),
            } as PortResult<T>,
          };
        }

        let response: Response;
        try {
          response = await this.#fetch(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'strict-origin-when-cross-origin',
            signal,
          });
        } catch {
          const failure: AttemptFailure = signal.aborted
            ? { kind: 'cancelled' }
            : { kind: 'network' };
          return { ok: false, failure };
        }

        if (!response.ok) {
          return {
            ok: false,
            failure: {
              kind: 'http',
              status: response.status,
              retryAfter: response.headers.get('retry-after'),
            },
          };
        }

        let parsed: ValidationResult<unknown>;
        try {
          parsed = await readBoundedJson(response);
        } catch {
          return { ok: false, failure: { kind: 'validation' } };
        }
        if (!parsed.valid) {
          return { ok: false, failure: { kind: 'validation' } };
        }
        const mapped = mapper(parsed.value, {
          status: response.status,
          retrievedAtEpochMs: this.#clock.nowEpochMs(),
        });
        return mapped.kind === 'failure' &&
          mapped.error.category === 'validation'
          ? { ok: false, failure: { kind: 'validation' } }
          : { ok: true, value: mapped };
      },
    );

    return execution.ok
      ? execution.value
      : classifyFailure(execution, this.#clock.nowEpochMs());
  }
}
