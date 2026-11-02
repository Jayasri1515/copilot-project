import { describe, expect, it, vi } from 'vitest';
import {
  BUDGET_STORAGE_KEY,
  BroadcastBudgetChannel,
  LocalStorageBudgetAdapter,
  type BroadcastChannelLike,
  type LockLike,
  type LockManagerLike,
} from '../../../src/adapters/budget';
import {
  HOUR_WINDOW_MS,
  deserializeBudgetDocument,
  serializeBudgetDocument,
} from '../../../src/application/budget';
import type { RequestBudgetDocument } from '../../../src/domain/models';

class FakeStorage implements Storage {
  readonly values = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;
  confirmWrongValue = false;
  private afterSet = false;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null {
    if (this.throwOnGet) throw new DOMException('blocked', 'SecurityError');
    if (this.confirmWrongValue && this.afterSet) return '{"changed":true}';
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new DOMException('quota', 'QuotaExceededError');
    this.values.set(key, value);
    this.afterSet = true;
  }
}

class ExclusiveLocks implements LockManagerLike {
  private tail: Promise<void> = Promise.resolve();
  request<T>(
    _name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: (lock: LockLike | null) => Promise<T>,
  ): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }
    const result = this.tail.then(() => callback({}));
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

class DeniedLocks implements LockManagerLike {
  request<T>(
    _name: string,
    _options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: (lock: LockLike | null) => Promise<T>,
  ): Promise<T> {
    return callback(null);
  }
}

class CancellableWaitingLocks implements LockManagerLike {
  request<T>(
    _name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    _callback: (lock: LockLike | null) => Promise<T>,
  ): Promise<T> {
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      );
    });
  }
}

class FakeBroadcast implements BroadcastChannelLike {
  readonly posts: unknown[] = [];
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  postMessage(message: unknown): void { this.posts.push(message); }
  addEventListener(
    _type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void { this.listeners.add(listener); }
  removeEventListener(
    _type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void { this.listeners.delete(listener); }
  close(): void {}
  receive(data: unknown): void {
    for (const listener of this.listeners) {
      listener({ data } as MessageEvent<unknown>);
    }
  }
}

function ids(): () => string {
  let next = 0;
  return () => `attempt_${++next}`;
}

function stored(storage: FakeStorage): RequestBudgetDocument {
  const parsed = deserializeBudgetDocument(storage.values.get(BUDGET_STORAGE_KEY) ?? null);
  if (!parsed) throw new Error('expected valid counter');
  return parsed;
}

describe('LocalStorageBudgetAdapter', () => {
  it('serializes concurrent tab reservations without lost updates', async () => {
    const storage = new FakeStorage();
    const locks = new ExclusiveLocks();
    const createAttemptId = ids();
    const first = new LocalStorageBudgetAdapter({
      storage, locks, createAttemptId,
    });
    const second = new LocalStorageBudgetAdapter({
      storage, locks, createAttemptId,
    });
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        (index % 2 ? first : second).reserve(10_000)),
    );
    expect(results.every(({ kind }) => kind === 'success')).toBe(true);
    expect(stored(storage).attempts).toHaveLength(100);
    const blocked = await second.reserve(10_001);
    expect(blocked).toMatchObject({
      kind: 'failure',
      error: { category: 'rate_limited' },
    });
    expect(stored(storage).attempts).toHaveLength(100);
  });

  it('counts automatic retry reservations as separate attempts', async () => {
    const storage = new FakeStorage();
    const adapter = new LocalStorageBudgetAdapter({
      storage,
      locks: new ExclusiveLocks(),
      createAttemptId: ids(),
    });
    await expect(adapter.reserve(1)).resolves.toMatchObject({ kind: 'success' });
    await expect(adapter.reserve(2)).resolves.toMatchObject({ kind: 'success' });
    expect(stored(storage).attempts).toHaveLength(2);
  });

  it('allows another request at exact hourly expiry', async () => {
    const storage = new FakeStorage();
    storage.setItem(BUDGET_STORAGE_KEY, serializeBudgetDocument({
      version: 1,
      attempts: Array.from({ length: 100 }, (_, index) => ({
        id: `old_${index}`,
        occurredAtEpochMs: 0,
      })),
      revision: 100,
    }));
    const adapter = new LocalStorageBudgetAdapter({
      storage,
      locks: new ExclusiveLocks(),
      createAttemptId: () => 'boundary',
    });
    await expect(adapter.reserve(HOUR_WINDOW_MS)).resolves.toMatchObject({
      kind: 'success',
      value: { reservedAtEpochMs: HOUR_WINDOW_MS },
    });
  });

  it.each([
    ['missing storage', { storage: null, locks: new ExclusiveLocks() }],
    ['missing locks', { storage: new FakeStorage(), locks: null }],
    ['denied lock', { storage: new FakeStorage(), locks: new DeniedLocks() }],
  ] as const)('fails closed for %s', async (_name, options) => {
    const adapter = new LocalStorageBudgetAdapter({
      ...options,
      createAttemptId: () => 'id',
    });
    await expect(adapter.reserve(1)).resolves.toMatchObject({
      kind: 'failure',
    });
  });

  it('fails closed on cancellation while acquiring the lock', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new LocalStorageBudgetAdapter({
      storage: new FakeStorage(),
      locks: new ExclusiveLocks(),
      createAttemptId: () => 'id',
    });
    await expect(adapter.reserve(1, { signal: controller.signal }))
      .resolves.toMatchObject({
        kind: 'failure',
        error: { category: 'cancelled' },
      });
  });

  it('fails closed when a queued lock acquisition is cancelled', async () => {
    const controller = new AbortController();
    const adapter = new LocalStorageBudgetAdapter({
      storage: new FakeStorage(),
      locks: new CancellableWaitingLocks(),
      createAttemptId: () => 'id',
    });
    const reservation = adapter.reserve(1, { signal: controller.signal });
    controller.abort();
    await expect(reservation).resolves.toMatchObject({
      kind: 'failure',
      error: { category: 'cancelled' },
    });
  });

  it.each(['read', 'write', 'confirm', 'corrupt'] as const)(
    'fails closed when durable %s is uncertain',
    async (failure) => {
      const storage = new FakeStorage();
      if (failure === 'read') storage.throwOnGet = true;
      if (failure === 'write') storage.throwOnSet = true;
      if (failure === 'confirm') storage.confirmWrongValue = true;
      if (failure === 'corrupt') {
        storage.values.set(BUDGET_STORAGE_KEY, '{"version":1}');
      }
      const adapter = new LocalStorageBudgetAdapter({
        storage,
        locks: new ExclusiveLocks(),
        createAttemptId: () => 'id',
      });
      await expect(adapter.reserve(1)).resolves.toMatchObject({
        kind: 'failure',
        error: { category: 'storage' },
      });
    },
  );

  it('notifies locally and through active-tab BroadcastChannel messages', async () => {
    const storage = new FakeStorage();
    const nativeChannel = new FakeBroadcast();
    const channel = new BroadcastBudgetChannel(() => nativeChannel);
    const adapter = new LocalStorageBudgetAdapter({
      storage,
      locks: new ExclusiveLocks(),
      channel,
      createAttemptId: () => 'id',
    });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe(listener);
    await adapter.reserve(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(nativeChannel.posts).toEqual([
      { type: 'request-budget-changed', version: 1 },
    ]);
    nativeChannel.receive({ type: 'ignored', version: 1 });
    nativeChannel.receive({ type: 'request-budget-changed', version: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('uses storage-event convergence and ignores invalid events', () => {
    const storage = new FakeStorage();
    const source = new EventTarget();
    const adapter = new LocalStorageBudgetAdapter({
      storage,
      locks: new ExclusiveLocks(),
      eventSource: source as Window,
      channel: new BroadcastBudgetChannel(() => {
        throw new Error('BroadcastChannel unavailable');
      }),
      createAttemptId: () => 'id',
    });
    const listener = vi.fn();
    adapter.subscribe(listener);
    const event = (newValue: string) => {
      const value = new Event('storage');
      Object.defineProperties(value, {
        key: { value: BUDGET_STORAGE_KEY },
        newValue: { value: newValue },
        storageArea: { value: null },
      });
      return value;
    };
    source.dispatchEvent(event(serializeBudgetDocument({
      version: 1,
      attempts: [{ id: 'external', occurredAtEpochMs: 1 }],
      revision: 1,
    })));
    source.dispatchEvent(event('{'));
    expect(listener).toHaveBeenCalledOnce();
  });
});
