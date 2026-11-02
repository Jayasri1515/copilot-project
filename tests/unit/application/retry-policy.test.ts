import { describe, expect, it, vi } from 'vitest';
import type {
  Clock,
  RandomSource,
  Timer,
  TimerHandle,
} from '../../../src/application/ports/Clock';
import {
  ATTEMPT_TIMEOUT_MS,
  jitteredBackoff,
  ManualRetryGate,
  parseRetryAfter,
  RetryEmbargoes,
  RetryPolicy,
  isTransientFailure,
  type Attempt,
  type AttemptFailure,
} from '../../../src/application/weather';

class FakeTime implements Clock, Timer {
  now = 0;
  #nextId = 1;
  readonly #tasks = new Map<number, { at: number; callback: () => void }>();

  nowEpochMs(): number {
    return this.now;
  }

  set(delayMs: number, callback: () => void): TimerHandle {
    const id = this.#nextId++;
    this.#tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  }

  clear(handle: TimerHandle): void {
    this.#tasks.delete(handle as number);
  }

  advance(milliseconds: number): void {
    const target = this.now + milliseconds;
    while (true) {
      const due = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!due) break;
      this.now = due[1].at;
      this.#tasks.delete(due[0]);
      due[1].callback();
    }
    this.now = target;
  }

  pending(): number {
    return this.#tasks.size;
  }
}

const random = (value: number): RandomSource => ({ next: () => value });
const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

describe('retry classification and timing primitives', () => {
  it.each([
    [{ kind: 'network' } as const, true],
    [{ kind: 'timeout' } as const, true],
    [{ kind: 'http', status: 408 } as const, true],
    [{ kind: 'http', status: 429 } as const, true],
    [{ kind: 'http', status: 500 } as const, true],
    [{ kind: 'http', status: 599 } as const, true],
    [{ kind: 'http', status: 400 } as const, false],
    [{ kind: 'http', status: 404 } as const, false],
    [{ kind: 'validation' } as const, false],
    [{ kind: 'cancelled' } as const, false],
  ])('classifies %o transient=%s', (failure, expected) => {
    expect(isTransientFailure(failure)).toBe(expected);
  });

  it('parses delta seconds, dates, past dates, and rejects invalid values', () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    expect(parseRetryAfter('10', now)).toBe(now + 10_000);
    expect(parseRetryAfter('Tue, 27 Oct 2026 10:00:05 GMT', now)).toBe(
      now + 5_000,
    );
    expect(parseRetryAfter('Tue, 27 Oct 2026 09:59:59 GMT', now)).toBe(now);
    expect(parseRetryAfter('-1', now)).toBeNull();
    expect(parseRetryAfter('1.5', now)).toBeNull();
    expect(parseRetryAfter('not-a-date', now)).toBeNull();
    expect(parseRetryAfter(undefined, now)).toBeNull();
  });

  it('selects inclusive fallback bounds and rejects a broken random source', () => {
    expect(jitteredBackoff(random(0))).toBe(250);
    expect(jitteredBackoff(random(0.999_999))).toBe(1_000);
    expect(() => jitteredBackoff(random(1))).toThrow(RangeError);
  });
});

describe('RetryPolicy', () => {
  it('times out each attempt at 10 seconds and makes at most one retry', async () => {
    const time = new FakeTime();
    const calls: AbortSignal[] = [];
    const policy = new RetryPolicy({ clock: time, timer: time, random: random(0) });
    const operation = policy.execute({ scope: 'weather' }, ({ signal }) => {
      calls.push(signal);
      return new Promise(() => {});
    });

    await flush();
    time.advance(ATTEMPT_TIMEOUT_MS - 1);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.aborted).toBe(false);

    time.advance(1);
    await flush();
    expect(calls[0]?.aborted).toBe(true);
    time.advance(249);
    await flush();
    expect(calls).toHaveLength(1);
    time.advance(1);
    await flush();
    expect(calls).toHaveLength(2);

    time.advance(ATTEMPT_TIMEOUT_MS);
    await expect(operation).resolves.toEqual({
      ok: false,
      failure: { kind: 'timeout' },
      attempts: 2,
    });
    expect(time.pending()).toBe(0);
  });

  it.each<AttemptFailure>([
    { kind: 'network' },
    { kind: 'http', status: 408 },
    { kind: 'http', status: 429 },
    { kind: 'http', status: 503 },
  ])('retries one transient failure and succeeds: %o', async (firstFailure) => {
    const time = new FakeTime();
    const attempt = vi
      .fn<Attempt<string>>()
      .mockResolvedValueOnce({ ok: false, failure: firstFailure })
      .mockResolvedValueOnce({ ok: true, value: 'ok' });
    const operation = new RetryPolicy({
      clock: time,
      timer: time,
      random: random(0),
    }).execute({ scope: 'provider' }, attempt);
    await flush();
    time.advance(250);
    await expect(operation).resolves.toEqual({
      ok: true,
      value: 'ok',
      attempts: 2,
    });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it.each<AttemptFailure>([
    { kind: 'validation' },
    { kind: 'http', status: 400 },
    { kind: 'http', status: 401 },
    { kind: 'http', status: 404 },
  ])('does not retry non-transient failure: %o', async (failure) => {
    const time = new FakeTime();
    const attempt = vi.fn<Attempt<string>>().mockResolvedValue({
      ok: false,
      failure,
    });
    await expect(
      new RetryPolicy({ clock: time, timer: time, random: random(0) }).execute(
        { scope: 'provider' },
        attempt,
      ),
    ).resolves.toMatchObject({ ok: false, failure, attempts: 1 });
    expect(attempt).toHaveBeenCalledOnce();
  });

  it('honors Retry-After at the exact embargo boundary', async () => {
    const time = new FakeTime();
    const embargoes = new RetryEmbargoes(time);
    const attempt = vi
      .fn<Attempt<string>>()
      .mockResolvedValueOnce({
        ok: false,
        failure: { kind: 'http', status: 429, retryAfter: '10' },
      })
      .mockResolvedValueOnce({ ok: true, value: 'ok' });
    const operation = new RetryPolicy({
      clock: time,
      timer: time,
      random: random(0.5),
      embargoes,
    }).execute({ scope: 'weather' }, attempt);

    await flush();
    expect(embargoes.blockedUntil('weather')).toBe(10_000);
    time.advance(9_999);
    await flush();
    expect(attempt).toHaveBeenCalledOnce();
    expect(embargoes.blockedUntil('weather')).toBe(10_000);
    time.advance(1);
    await expect(operation).resolves.toMatchObject({ ok: true, attempts: 2 });
    expect(embargoes.blockedUntil('weather')).toBeNull();
  });

  it('ends active loading for a long Retry-After but preserves its full embargo', async () => {
    const time = new FakeTime();
    const embargoes = new RetryEmbargoes(time);
    const attempt = vi.fn<Attempt<string>>().mockResolvedValue({
      ok: false,
      failure: { kind: 'http', status: 503, retryAfter: '120' },
    });
    const policy = new RetryPolicy({
      clock: time,
      timer: time,
      random: random(0),
      embargoes,
    });

    await expect(policy.execute({ scope: 'weather' }, attempt)).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 503, retryAfter: '120' },
      attempts: 1,
      retryAllowedAtEpochMs: 120_000,
    });
    await expect(policy.execute({ scope: 'weather' }, attempt)).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 429 },
      attempts: 0,
      retryAllowedAtEpochMs: 120_000,
    });
    time.advance(119_999);
    expect(embargoes.blockedUntil('weather')).toBe(120_000);
    time.advance(1);
    expect(embargoes.blockedUntil('weather')).toBeNull();
    expect(attempt).toHaveBeenCalledOnce();
  });

  it('falls back to jitter when Retry-After is invalid', async () => {
    const time = new FakeTime();
    const attempt = vi
      .fn<Attempt<string>>()
      .mockResolvedValueOnce({
        ok: false,
        failure: { kind: 'http', status: 429, retryAfter: 'invalid' },
      })
      .mockResolvedValueOnce({ ok: true, value: 'ok' });
    const operation = new RetryPolicy({
      clock: time,
      timer: time,
      random: random(0.999_999),
    }).execute({ scope: 'provider' }, attempt);
    await flush();
    time.advance(999);
    await flush();
    expect(attempt).toHaveBeenCalledOnce();
    time.advance(1);
    await expect(operation).resolves.toMatchObject({ ok: true, attempts: 2 });
  });

  it('cancels an attempt, aborts dispatch, and ignores late completion', async () => {
    const time = new FakeTime();
    const external = new AbortController();
    let complete!: (value: { ok: true; value: string }) => void;
    let attemptSignal: AbortSignal | undefined;
    const attempt: Attempt<string> = ({ signal }) => {
      attemptSignal = signal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    };
    const operation = new RetryPolicy({
      clock: time,
      timer: time,
      random: random(0),
    }).execute({ scope: 'weather', signal: external.signal }, attempt);
    await flush();
    external.abort();
    await expect(operation).resolves.toEqual({
      ok: false,
      failure: { kind: 'cancelled' },
      attempts: 1,
    });
    expect(attemptSignal?.aborted).toBe(true);
    complete({ ok: true, value: 'late' });
    await flush();
    expect(time.pending()).toBe(0);
  });

  it('does not dispatch when already cancelled or superseded before dispatch', async () => {
    const time = new FakeTime();
    const external = new AbortController();
    external.abort();
    const attempt = vi.fn<Attempt<string>>();
    await expect(
      new RetryPolicy({ clock: time, timer: time, random: random(0) }).execute(
        { scope: 'weather', signal: external.signal },
        attempt,
      ),
    ).resolves.toEqual({
      ok: false,
      failure: { kind: 'cancelled' },
      attempts: 0,
    });
    expect(attempt).not.toHaveBeenCalled();
    expect(time.pending()).toBe(0);
  });

  it('cancels during retry backoff without dispatching another attempt', async () => {
    const time = new FakeTime();
    const external = new AbortController();
    const attempt = vi.fn<Attempt<string>>().mockResolvedValue({
      ok: false,
      failure: { kind: 'network' },
    });
    const operation = new RetryPolicy({
      clock: time,
      timer: time,
      random: random(0),
    }).execute({ scope: 'weather', signal: external.signal }, attempt);
    await flush();
    external.abort();
    await expect(operation).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'cancelled' },
      attempts: 1,
    });
    time.advance(1_000);
    expect(attempt).toHaveBeenCalledOnce();
  });
});

describe('ManualRetryGate', () => {
  it('enforces cooldown just before and permits at the exact boundary', () => {
    const time = new FakeTime();
    const embargoes = new RetryEmbargoes(time);
    const gate = new ManualRetryGate(time, embargoes);
    expect(gate.tryStart('weather')).toEqual({ allowed: true });
    expect(gate.tryStart('weather')).toEqual({
      allowed: false,
      retryAllowedAtEpochMs: 1_000,
    });
    time.advance(999);
    expect(gate.blockedUntil('weather')).toBe(1_000);
    time.advance(1);
    expect(gate.tryStart('weather')).toEqual({ allowed: true });
  });

  it('gives a longer provider embargo precedence over cooldown', () => {
    const time = new FakeTime();
    const embargoes = new RetryEmbargoes(time);
    const gate = new ManualRetryGate(time, embargoes);
    expect(gate.tryStart('weather')).toEqual({ allowed: true });
    embargoes.record('weather', 20_000);
    time.advance(1_000);
    expect(gate.tryStart('weather')).toEqual({
      allowed: false,
      retryAllowedAtEpochMs: 20_000,
    });
  });
});
