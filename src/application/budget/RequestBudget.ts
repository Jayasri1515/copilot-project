import type {
  Clock,
  RequestBudgetCoordinationPort,
  RequestOptions,
} from '../ports';
import { operationError } from '../../domain/errors';
import type { PortResult } from '../../domain/models/results';
import type { RequestBudgetReservation } from '../ports';

export interface EmbargoReader {
  blockedUntil(scope: string): number | null;
}

/** Applies a provider embargo before consuming a local budget reservation. */
export class RequestBudget {
  readonly #clock: Clock;
  readonly #coordination: RequestBudgetCoordinationPort;
  readonly #embargoes?: EmbargoReader;

  constructor(dependencies: {
    readonly clock: Clock;
    readonly coordination: RequestBudgetCoordinationPort;
    readonly embargoes?: EmbargoReader;
  }) {
    this.#clock = dependencies.clock;
    this.#coordination = dependencies.coordination;
    this.#embargoes = dependencies.embargoes;
  }

  reserve(
    scope: string,
    options?: RequestOptions,
  ): Promise<PortResult<RequestBudgetReservation>> {
    const now = this.#clock.nowEpochMs();
    const embargo = this.#embargoes?.blockedUntil(scope) ?? null;
    if (embargo !== null && embargo > now) {
      return Promise.resolve({
        kind: 'failure',
        error: operationError(
          'rate_limited',
          true,
          'rate_limited',
          embargo - now,
        ),
      });
    }
    return this.#coordination.reserve(now, options);
  }
}
