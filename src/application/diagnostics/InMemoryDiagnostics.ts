import type { Clock } from '../ports/Clock';

export type DiagnosticOutcome =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'blocked';

export type DiagnosticCategory =
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'http_client'
  | 'http_server'
  | 'validation'
  | 'cancelled'
  | 'storage';

export type CoarseLatency = 'under_250ms' | 'under_1s' | 'under_10s' | '10s_plus';

export interface DiagnosticInput {
  readonly outcome: DiagnosticOutcome;
  readonly category?: DiagnosticCategory;
  readonly latencyMs: number;
  readonly retried?: boolean;
  readonly timedOut?: boolean;
  readonly tokenRejected?: boolean;
  readonly deduplicated?: boolean;
  readonly storageFailure?: boolean;
}

export interface SafeDiagnostic {
  readonly sequence: number;
  readonly recordedAtEpochMs: number;
  readonly outcome: DiagnosticOutcome;
  readonly category?: DiagnosticCategory;
  readonly latency: CoarseLatency;
  readonly retried: boolean;
  readonly timedOut: boolean;
  readonly tokenRejected: boolean;
  readonly deduplicated: boolean;
  readonly storageFailure: boolean;
}

export interface DiagnosticSink {
  record(input: DiagnosticInput): void;
}

function coarseLatency(milliseconds: number): CoarseLatency {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new RangeError('latencyMs must be a non-negative finite number');
  }
  if (milliseconds < 250) return 'under_250ms';
  if (milliseconds < 1_000) return 'under_1s';
  if (milliseconds < 10_000) return 'under_10s';
  return '10s_plus';
}

/**
 * Session-only safe diagnostics. This class intentionally has no persistence,
 * serialization, transmission, or support-export dependency.
 */
export class InMemoryDiagnostics implements DiagnosticSink {
  readonly #entries: SafeDiagnostic[] = [];
  readonly #capacity: number;
  readonly #clock: Clock;
  #sequence = 0;

  constructor(clock: Clock, capacity = 100) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 500) {
      throw new RangeError('diagnostic capacity must be an integer from 1 to 500');
    }
    this.#clock = clock;
    this.#capacity = capacity;
  }

  record(input: DiagnosticInput): void {
    const entry: SafeDiagnostic = Object.freeze({
      sequence: ++this.#sequence,
      recordedAtEpochMs: this.#clock.nowEpochMs(),
      outcome: input.outcome,
      ...(input.category === undefined ? {} : { category: input.category }),
      latency: coarseLatency(input.latencyMs),
      retried: input.retried === true,
      timedOut: input.timedOut === true,
      tokenRejected: input.tokenRejected === true,
      deduplicated: input.deduplicated === true,
      storageFailure: input.storageFailure === true,
    });
    if (this.#entries.length === this.#capacity) this.#entries.shift();
    this.#entries.push(entry);
  }

  entries(): readonly SafeDiagnostic[] {
    return Object.freeze(this.#entries.map((entry) => Object.freeze({ ...entry })));
  }

  clear(): void {
    this.#entries.length = 0;
  }
}
