import type { DiagnosticCategory, DiagnosticSink } from '../diagnostics';
import type { Clock, RandomSource, Timer, TimerHandle } from '../ports/Clock';

export const ATTEMPT_TIMEOUT_MS = 10_000;
export const MAX_AUTOMATIC_RETRY_WAIT_MS = 10_000;
export const MANUAL_RETRY_COOLDOWN_MS = 1_000;
export const MIN_RETRY_BACKOFF_MS = 250;
export const MAX_RETRY_BACKOFF_MS = 1_000;

export type AttemptFailure =
  | { readonly kind: 'network' }
  | { readonly kind: 'timeout' }
  | {
      readonly kind: 'http';
      readonly status: number;
      readonly retryAfter?: string | null;
    }
  | { readonly kind: 'validation' }
  | { readonly kind: 'cancelled' };

export type AttemptResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AttemptFailure };

export interface AttemptContext {
  readonly attempt: 1 | 2;
  readonly signal: AbortSignal;
}

export type Attempt<T> = (
  context: AttemptContext,
) => Promise<AttemptResult<T>>;

export interface RetrySuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly attempts: number;
}

export interface RetryFailure {
  readonly ok: false;
  readonly failure: AttemptFailure;
  readonly attempts: number;
  readonly retryAllowedAtEpochMs?: number;
}

export type RetryResult<T> = RetrySuccess<T> | RetryFailure;

export interface RetryExecutionOptions {
  /** A provider or operation scope. It is used only as an in-memory map key. */
  readonly scope: string;
  readonly signal?: AbortSignal;
}

export function isTransientFailure(failure: AttemptFailure): boolean {
  if (failure.kind === 'network' || failure.kind === 'timeout') return true;
  if (failure.kind !== 'http') return false;
  return (
    failure.status === 408 ||
    failure.status === 429 ||
    (failure.status >= 500 && failure.status <= 599)
  );
}

/** Returns an absolute embargo instant, or null for an invalid/absent value. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowEpochMs: number,
): number | null {
  if (!Number.isFinite(nowEpochMs)) return null;
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    const result = nowEpochMs + seconds * 1_000;
    return Number.isSafeInteger(seconds) && Number.isSafeInteger(result)
      ? result
      : null;
  }

  // Retry-After uses IMF-fixdate. Re-formatting also rejects normalized
  // impossible dates and incorrect weekday/date combinations.
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      trimmed,
    )
  ) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed) || new Date(parsed).toUTCString() !== trimmed) {
    return null;
  }
  return Math.max(nowEpochMs, parsed);
}

export function jitteredBackoff(random: RandomSource): number {
  const value = random.next();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('random source must return a value in [0, 1)');
  }
  return MIN_RETRY_BACKOFF_MS + Math.floor(value * 751);
}

function categoryFor(failure: AttemptFailure): DiagnosticCategory {
  if (failure.kind !== 'http') return failure.kind;
  if (failure.status === 429) return 'rate_limited';
  return failure.status >= 500 ? 'http_server' : 'http_client';
}

interface WaitResult {
  readonly cancelled: boolean;
}

export class RetryEmbargoes {
  readonly #expiries = new Map<string, number>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  record(scope: string, expiryEpochMs: number): void {
    if (!scope || !Number.isFinite(expiryEpochMs)) {
      throw new RangeError('scope and finite expiry are required');
    }
    const existing = this.#expiries.get(scope) ?? 0;
    this.#expiries.set(scope, Math.max(existing, expiryEpochMs));
  }

  blockedUntil(scope: string): number | null {
    const expiry = this.#expiries.get(scope);
    if (expiry === undefined) return null;
    if (this.#clock.nowEpochMs() >= expiry) {
      this.#expiries.delete(scope);
      return null;
    }
    return expiry;
  }

  clear(): void {
    this.#expiries.clear();
  }
}

export class ManualRetryGate {
  readonly #lastStarts = new Map<string, number>();
  readonly #clock: Clock;
  readonly #embargoes: RetryEmbargoes;

  constructor(clock: Clock, embargoes: RetryEmbargoes) {
    this.#clock = clock;
    this.#embargoes = embargoes;
  }

  blockedUntil(scope: string): number | null {
    const now = this.#clock.nowEpochMs();
    const cooldown = (this.#lastStarts.get(scope) ?? -Infinity) +
      MANUAL_RETRY_COOLDOWN_MS;
    const embargo = this.#embargoes.blockedUntil(scope) ?? -Infinity;
    const blockedUntil = Math.max(cooldown, embargo);
    return blockedUntil > now ? blockedUntil : null;
  }

  tryStart(scope: string): { readonly allowed: true } | {
    readonly allowed: false;
    readonly retryAllowedAtEpochMs: number;
  } {
    const blockedUntil = this.blockedUntil(scope);
    if (blockedUntil !== null) {
      return { allowed: false, retryAllowedAtEpochMs: blockedUntil };
    }
    this.#lastStarts.set(scope, this.#clock.nowEpochMs());
    return { allowed: true };
  }
}

export class RetryPolicy {
  readonly #clock: Clock;
  readonly #timer: Timer;
  readonly #random: RandomSource;
  readonly #embargoes: RetryEmbargoes;
  readonly #diagnostics?: DiagnosticSink;

  constructor(dependencies: {
    readonly clock: Clock;
    readonly timer: Timer;
    readonly random: RandomSource;
    readonly embargoes?: RetryEmbargoes;
    readonly diagnostics?: DiagnosticSink;
  }) {
    this.#clock = dependencies.clock;
    this.#timer = dependencies.timer;
    this.#random = dependencies.random;
    this.#embargoes =
      dependencies.embargoes ?? new RetryEmbargoes(dependencies.clock);
    this.#diagnostics = dependencies.diagnostics;
  }

  get embargoes(): RetryEmbargoes {
    return this.#embargoes;
  }

  async execute<T>(
    options: RetryExecutionOptions,
    attempt: Attempt<T>,
  ): Promise<RetryResult<T>> {
    const startedAt = this.#clock.nowEpochMs();
    if (options.signal?.aborted) {
      const result: RetryFailure = {
        ok: false,
        failure: { kind: 'cancelled' },
        attempts: 0,
      };
      this.#record(result, startedAt, false);
      return result;
    }
    const preexistingEmbargo = this.#embargoes.blockedUntil(options.scope);
    if (preexistingEmbargo !== null) {
      const result: RetryFailure = {
        ok: false,
        failure: { kind: 'http', status: 429 },
        attempts: 0,
        retryAllowedAtEpochMs: preexistingEmbargo,
      };
      this.#record(result, startedAt, false);
      return result;
    }

    let lastFailure: AttemptFailure = { kind: 'network' };
    for (const attemptNumber of [1, 2] as const) {
      const result = await this.#runAttempt(attemptNumber, options.signal, attempt);
      if (result.ok) {
        const success: RetrySuccess<T> = {
          ok: true,
          value: result.value,
          attempts: attemptNumber,
        };
        this.#record(success, startedAt, attemptNumber === 2);
        return success;
      }
      lastFailure = result.failure;

      const retryAfter =
        isTransientFailure(lastFailure) && lastFailure.kind === 'http'
          ? parseRetryAfter(lastFailure.retryAfter, this.#clock.nowEpochMs())
          : null;
      if (retryAfter !== null) {
        this.#embargoes.record(options.scope, retryAfter);
      }

      if (
        attemptNumber === 2 ||
        !isTransientFailure(lastFailure) ||
        lastFailure.kind === 'cancelled'
      ) {
        const failure: RetryFailure = {
          ok: false,
          failure: lastFailure,
          attempts: attemptNumber,
          ...(retryAfter === null
            ? {}
            : { retryAllowedAtEpochMs: retryAfter }),
        };
        this.#record(failure, startedAt, attemptNumber === 2);
        return failure;
      }

      const waitMs =
        retryAfter === null
          ? jitteredBackoff(this.#random)
          : Math.max(0, retryAfter - this.#clock.nowEpochMs());

      if (waitMs > MAX_AUTOMATIC_RETRY_WAIT_MS) {
        const failure: RetryFailure = {
          ok: false,
          failure: lastFailure,
          attempts: attemptNumber,
          retryAllowedAtEpochMs: retryAfter ?? undefined,
        };
        this.#record(failure, startedAt, false);
        return failure;
      }

      const wait = await this.#wait(waitMs, options.signal);
      if (wait.cancelled) {
        const failure: RetryFailure = {
          ok: false,
          failure: { kind: 'cancelled' },
          attempts: attemptNumber,
        };
        this.#record(failure, startedAt, false);
        return failure;
      }
    }

    // The fixed tuple above is exhaustive; this keeps TypeScript total.
    return { ok: false, failure: lastFailure, attempts: 2 };
  }

  #runAttempt<T>(
    attemptNumber: 1 | 2,
    externalSignal: AbortSignal | undefined,
    attempt: Attempt<T>,
  ): Promise<AttemptResult<T>> {
    if (externalSignal?.aborted) {
      return Promise.resolve({ ok: false, failure: { kind: 'cancelled' } });
    }

    return new Promise((resolve) => {
      const controller = new AbortController();
      let settled = false;
      let timeoutHandle: TimerHandle;

      const finish = (result: AttemptResult<T>) => {
        if (settled) return;
        settled = true;
        this.#timer.clear(timeoutHandle);
        externalSignal?.removeEventListener('abort', cancel);
        resolve(result);
      };
      const cancel = () => {
        controller.abort();
        finish({ ok: false, failure: { kind: 'cancelled' } });
      };

      timeoutHandle = this.#timer.set(ATTEMPT_TIMEOUT_MS, () => {
        controller.abort();
        finish({ ok: false, failure: { kind: 'timeout' } });
      });
      externalSignal?.addEventListener('abort', cancel, { once: true });

      void Promise.resolve()
        .then(() =>
          controller.signal.aborted
            ? ({ ok: false, failure: { kind: 'cancelled' } } as const)
            : attempt({ attempt: attemptNumber, signal: controller.signal }),
        )
        .then(
          (result) => finish(result),
          () => finish({ ok: false, failure: { kind: 'network' } }),
        );
    });
  }

  #wait(milliseconds: number, signal?: AbortSignal): Promise<WaitResult> {
    if (signal?.aborted) return Promise.resolve({ cancelled: true });
    return new Promise((resolve) => {
      let settled = false;
      let handle: TimerHandle;
      const finish = (cancelled: boolean) => {
        if (settled) return;
        settled = true;
        this.#timer.clear(handle);
        signal?.removeEventListener('abort', cancel);
        resolve({ cancelled });
      };
      const cancel = () => finish(true);
      handle = this.#timer.set(milliseconds, () => finish(false));
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  #record<T>(
    result: RetryResult<T>,
    startedAt: number,
    retried: boolean,
  ): void {
    const latencyMs = Math.max(0, this.#clock.nowEpochMs() - startedAt);
    if (result.ok) {
      this.#diagnostics?.record({ outcome: 'success', latencyMs, retried });
      return;
    }
    this.#diagnostics?.record({
      outcome:
        result.attempts === 0
          ? 'blocked'
          : result.failure.kind === 'cancelled'
            ? 'cancelled'
            : 'failure',
      category: categoryFor(result.failure),
      latencyMs,
      retried,
      timedOut: result.failure.kind === 'timeout',
    });
  }
}
