import { describe, expect, it, vi } from 'vitest';
import type { RequestBudgetDocument } from '../../../src/domain/models';
import type { RequestBudgetCoordinationPort } from '../../../src/application/ports';
import {
  DAILY_REQUEST_LIMIT,
  DAY_WINDOW_MS,
  HOUR_WINDOW_MS,
  HOURLY_REQUEST_LIMIT,
  RequestBudget,
  deserializeBudgetDocument,
  emptyBudgetDocument,
  prepareReservation,
  serializeBudgetDocument,
} from '../../../src/application/budget';

function document(
  times: readonly number[],
  revision = times.length,
): RequestBudgetDocument {
  return {
    version: 1,
    attempts: times.map((occurredAtEpochMs, index) => ({
      id: `attempt_${index}`,
      occurredAtEpochMs,
    })),
    revision,
  };
}

describe('request budget document and rolling policy', () => {
  it('uses exact rolling-window expiry boundaries', () => {
    const now = DAY_WINDOW_MS;
    const source = document([
      0,
      now - HOUR_WINDOW_MS,
      now - HOUR_WINDOW_MS + 1,
    ]);
    const decision = prepareReservation(source, now, 'next');
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.document.attempts.map((attempt) => attempt.occurredAtEpochMs))
      .toEqual([now - HOUR_WINDOW_MS, now - HOUR_WINDOW_MS + 1, now]);

    const dayBoundary = prepareReservation(
      document([0, 1]),
      DAY_WINDOW_MS,
      'day_next',
    );
    expect(dayBoundary.allowed).toBe(true);
    if (dayBoundary.allowed) {
      expect(dayBoundary.document.attempts.map(({ occurredAtEpochMs }) =>
        occurredAtEpochMs)).toEqual([1, DAY_WINDOW_MS]);
    }
  });

  it('allows 99, blocks the 101st hourly attempt, and does not count it', () => {
    const now = HOUR_WINDOW_MS;
    const first99 = document(Array.from({ length: 99 }, (_, index) => index + 1));
    const hundredth = prepareReservation(first99, now, 'hundredth');
    expect(hundredth.allowed).toBe(true);
    if (!hundredth.allowed) return;
    expect(hundredth.document.attempts).toHaveLength(HOURLY_REQUEST_LIMIT);
    const blocked = prepareReservation(
      hundredth.document,
      now,
      'blocked_101',
    );
    expect(blocked).toEqual({
      allowed: false,
      blockedUntilEpochMs: HOUR_WINDOW_MS + 1,
    });
    expect(hundredth.document.attempts).toHaveLength(100);
  });

  it('allows 499, blocks the 501st daily attempt, and reports exact expiry', () => {
    const times = Array.from(
      { length: 499 },
      (_, index) => index * DAY_WINDOW_MS / 500,
    );
    const now = times.at(-1)! + 1;
    const fiveHundredth = prepareReservation(
      document(times),
      now,
      'five_hundredth',
    );
    expect(fiveHundredth.allowed).toBe(true);
    if (!fiveHundredth.allowed) return;
    expect(fiveHundredth.document.attempts).toHaveLength(DAILY_REQUEST_LIMIT);
    const blocked = prepareReservation(
      fiveHundredth.document,
      now + 1,
      'blocked_501',
    );
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.blockedUntilEpochMs).toBe(DAY_WINDOW_MS);
    }
  });

  it('clamps a backward clock to the latest durable timestamp', () => {
    const forward = prepareReservation(
      document([10_000]),
      1_000,
      'after_rollback',
    );
    expect(forward).toMatchObject({
      allowed: true,
      reservedAtEpochMs: 10_000,
    });
    if (forward.allowed) {
      expect(forward.document.attempts.at(-1)?.occurredAtEpochMs).toBe(10_000);
    }
  });

  it('prunes after a forward jump and keeps a logical clock floor for rollback', () => {
    const jumped = prepareReservation(
      document([1]),
      DAY_WINDOW_MS + 1,
      'jumped',
    );
    expect(jumped.allowed).toBe(true);
    if (!jumped.allowed) return;
    expect(jumped.document.attempts).toHaveLength(1);
    const rolledBack = prepareReservation(jumped.document, 2, 'rolled_back');
    expect(rolledBack).toMatchObject({
      allowed: true,
      reservedAtEpochMs: DAY_WINDOW_MS + 1,
    });
  });

  it('strictly validates corrupt, future, duplicate, unsorted, and oversized counters', () => {
    const invalid = [
      '{',
      JSON.stringify({ version: 2, attempts: [], revision: 0 }),
      JSON.stringify({
        version: 1,
        attempts: [
          { id: 'same', occurredAtEpochMs: 1 },
          { id: 'same', occurredAtEpochMs: 2 },
        ],
        revision: 2,
      }),
      JSON.stringify({
        version: 1,
        attempts: [
          { id: 'a', occurredAtEpochMs: 2 },
          { id: 'b', occurredAtEpochMs: 1 },
        ],
        revision: 2,
      }),
      JSON.stringify({
        version: 1,
        attempts: Array.from({ length: 501 }, (_, index) => ({
          id: `id_${index}`,
          occurredAtEpochMs: index,
        })),
        revision: 501,
      }),
    ];
    for (const body of invalid) expect(deserializeBudgetDocument(body)).toBeNull();
    expect(deserializeBudgetDocument(null)).toEqual(emptyBudgetDocument());
    const valid = document([1, 2]);
    expect(deserializeBudgetDocument(serializeBudgetDocument(valid))).toEqual(valid);
  });

  it('checks a stricter provider embargo before consuming a reservation', async () => {
    const coordination = {
      reserve: vi.fn(),
    } as unknown as RequestBudgetCoordinationPort;
    const budget = new RequestBudget({
      clock: { nowEpochMs: () => 1_000 },
      coordination,
      embargoes: { blockedUntil: () => 5_000 },
    });
    await expect(budget.reserve('open-meteo')).resolves.toMatchObject({
      kind: 'failure',
      error: { category: 'rate_limited', retryAfterMs: 4_000 },
    });
    expect(coordination.reserve).not.toHaveBeenCalled();
  });
});
