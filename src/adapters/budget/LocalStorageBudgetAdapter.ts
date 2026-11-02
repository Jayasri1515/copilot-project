import {
  deserializeBudgetDocument,
  prepareReservation,
  serializeBudgetDocument,
} from '../../application/budget';
import type {
  RequestBudgetCoordinationPort,
  RequestBudgetReservation,
  RequestOptions,
} from '../../application/ports';
import { operationError } from '../../domain/errors';
import type { RequestBudgetDocument } from '../../domain/models';
import type { PortResult } from '../../domain/models/results';
import { BroadcastBudgetChannel } from './BroadcastBudgetChannel';

export const BUDGET_STORAGE_KEY = 'weather-browser.request-budget.v1';
export const BUDGET_LOCK_NAME = 'weather-browser.request-budget.v1';

type StorageEventSource = Pick<
  Window,
  'addEventListener' | 'removeEventListener'
>;

export interface LockLike {}
export interface LockManagerLike {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: (lock: LockLike | null) => Promise<T>,
  ): Promise<T>;
}

export interface LocalStorageBudgetAdapterOptions {
  /** null explicitly represents an unavailable browser API in tests/adapters. */
  readonly storage?: Storage | null;
  readonly locks?: LockManagerLike | null;
  readonly eventSource?: StorageEventSource;
  readonly channel?: BroadcastBudgetChannel;
  readonly createAttemptId?: () => string;
  readonly key?: string;
}

const metadata = Object.freeze({});
const coordinationFailure = () => ({
  kind: 'failure' as const,
  error: operationError('storage', false, 'storage_unavailable'),
});
const cancellationFailure = () => ({
  kind: 'failure' as const,
  error: operationError('cancelled', false, 'operation_cancelled'),
});

export class LocalStorageBudgetAdapter
implements RequestBudgetCoordinationPort {
  private readonly storage?: Storage;
  private readonly locks?: LockManagerLike;
  private readonly eventSource?: StorageEventSource;
  private readonly channel: BroadcastBudgetChannel;
  private readonly createAttemptId: () => string;
  private readonly key: string;
  private readonly listeners =
    new Set<(document: RequestBudgetDocument) => void>();
  private listening = false;
  private unsubscribeChannel?: () => void;

  constructor(options: LocalStorageBudgetAdapterOptions = {}) {
    this.key = options.key ?? BUDGET_STORAGE_KEY;
    this.eventSource =
      options.eventSource ?? (typeof window === 'undefined' ? undefined : window);
    this.channel = options.channel ?? new BroadcastBudgetChannel();
    this.createAttemptId =
      options.createAttemptId ?? (() => crypto.randomUUID());
    try {
      this.storage =
        options.storage === null
          ? undefined
          : options.storage ??
            (typeof window === 'undefined' ? undefined : window.localStorage);
    } catch {
      this.storage = undefined;
    }
    try {
      this.locks =
        options.locks === null
          ? undefined
          : options.locks ??
            (typeof navigator === 'undefined'
              ? undefined
              : (navigator.locks as unknown as LockManagerLike | undefined));
    } catch {
      this.locks = undefined;
    }
  }

  async reserve(
    nowEpochMs: number,
    options: RequestOptions = {},
  ): Promise<PortResult<RequestBudgetReservation>> {
    if (!this.storage || !this.locks) return coordinationFailure();
    if (options.signal?.aborted) return cancellationFailure();

    let attemptId: string;
    try {
      attemptId = this.createAttemptId();
    } catch {
      return coordinationFailure();
    }

    try {
      return await this.locks.request(
        BUDGET_LOCK_NAME,
        { mode: 'exclusive', signal: options.signal },
        async (lock) => {
          if (!lock) return coordinationFailure();
          if (options.signal?.aborted) return cancellationFailure();
          let currentBody: string | null;
          try {
            currentBody = this.storage!.getItem(this.key);
          } catch {
            return coordinationFailure();
          }
          const current = deserializeBudgetDocument(currentBody);
          if (!current) return coordinationFailure();

          let decision;
          try {
            decision = prepareReservation(current, nowEpochMs, attemptId);
          } catch {
            return coordinationFailure();
          }
          if (!decision.allowed) {
            return {
              kind: 'failure' as const,
              error: operationError(
                'rate_limited',
                true,
                'rate_limited',
                Math.max(0, decision.blockedUntilEpochMs - nowEpochMs),
              ),
            };
          }

          const body = serializeBudgetDocument(decision.document);
          try {
            this.storage!.setItem(this.key, body);
            if (this.storage!.getItem(this.key) !== body) {
              return coordinationFailure();
            }
          } catch {
            return coordinationFailure();
          }
          const confirmed = deserializeBudgetDocument(body);
          if (
            !confirmed ||
            confirmed.revision !== decision.document.revision ||
            confirmed.attempts.at(-1)?.id !== attemptId
          ) {
            return coordinationFailure();
          }

          this.notify(confirmed);
          this.channel.publish();
          return {
            kind: 'success' as const,
            value: {
              attemptId,
              reservedAtEpochMs: decision.reservedAtEpochMs,
            },
            metadata,
          };
        },
      );
    } catch {
      return options.signal?.aborted
        ? cancellationFailure()
        : coordinationFailure();
    }
  }

  async read(): Promise<PortResult<RequestBudgetDocument>> {
    if (!this.storage) return coordinationFailure();
    try {
      const document = deserializeBudgetDocument(
        this.storage.getItem(this.key),
      );
      return document
        ? { kind: 'success', value: document, metadata }
        : coordinationFailure();
    } catch {
      return coordinationFailure();
    }
  }

  subscribe(
    listener: (document: RequestBudgetDocument) => void,
  ): () => void {
    this.listeners.add(listener);
    if (!this.listening) {
      this.eventSource?.addEventListener('storage', this.onStorage);
      this.unsubscribeChannel = this.channel.subscribe(this.onBroadcast);
      this.listening = true;
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.listening) {
        this.eventSource?.removeEventListener('storage', this.onStorage);
        this.unsubscribeChannel?.();
        this.unsubscribeChannel = undefined;
        this.listening = false;
      }
    };
  }

  private readonly onStorage = (event: Event): void => {
    const storageEvent = event as StorageEvent;
    if (
      storageEvent.key !== this.key ||
      (storageEvent.storageArea !== null &&
        storageEvent.storageArea !== this.storage)
    ) {
      return;
    }
    const document = deserializeBudgetDocument(storageEvent.newValue);
    if (document && storageEvent.newValue !== null) this.notify(document);
  };

  private readonly onBroadcast = (): void => {
    void this.read().then((result) => {
      if (result.kind === 'success') this.notify(result.value);
    });
  };

  private notify(document: RequestBudgetDocument): void {
    for (const listener of this.listeners) listener(document);
  }
}
