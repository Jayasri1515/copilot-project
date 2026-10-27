import type { RequestBudgetDocument } from '../../domain/models';

export const BUDGET_DOCUMENT_VERSION = 1 as const;
export const HOURLY_REQUEST_LIMIT = 100;
export const DAILY_REQUEST_LIMIT = 500;
export const HOUR_WINDOW_MS = 60 * 60 * 1_000;
export const DAY_WINDOW_MS = 24 * HOUR_WINDOW_MS;

const attemptKeys = ['id', 'occurredAtEpochMs'];
const documentKeys = ['attempts', 'revision', 'version'];
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

export function emptyBudgetDocument(): RequestBudgetDocument {
  return Object.freeze({
    version: BUDGET_DOCUMENT_VERSION,
    attempts: Object.freeze([]),
    revision: 0,
  });
}

export function deserializeBudgetDocument(
  body: string | null,
): RequestBudgetDocument | null {
  if (body === null) return emptyBudgetDocument();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !hasExactKeys(value, documentKeys)
  ) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== BUDGET_DOCUMENT_VERSION ||
    !Number.isSafeInteger(candidate.revision) ||
    (candidate.revision as number) < 0 ||
    !Array.isArray(candidate.attempts) ||
    candidate.attempts.length > DAILY_REQUEST_LIMIT
  ) {
    return null;
  }

  const ids = new Set<string>();
  let previousTime = -1;
  const attempts: { id: string; occurredAtEpochMs: number }[] = [];
  for (const rawAttempt of candidate.attempts) {
    if (
      typeof rawAttempt !== 'object' ||
      rawAttempt === null ||
      !hasExactKeys(rawAttempt, attemptKeys)
    ) {
      return null;
    }
    const attempt = rawAttempt as Record<string, unknown>;
    if (
      typeof attempt.id !== 'string' ||
      !idPattern.test(attempt.id) ||
      ids.has(attempt.id) ||
      !Number.isSafeInteger(attempt.occurredAtEpochMs) ||
      (attempt.occurredAtEpochMs as number) < 0 ||
      (attempt.occurredAtEpochMs as number) < previousTime
    ) {
      return null;
    }
    ids.add(attempt.id);
    previousTime = attempt.occurredAtEpochMs as number;
    attempts.push(Object.freeze({
      id: attempt.id,
      occurredAtEpochMs: previousTime,
    }));
  }
  return Object.freeze({
    version: BUDGET_DOCUMENT_VERSION,
    attempts: Object.freeze(attempts),
    revision: candidate.revision as number,
  });
}

export function serializeBudgetDocument(
  document: RequestBudgetDocument,
): string {
  return JSON.stringify({
    version: BUDGET_DOCUMENT_VERSION,
    attempts: document.attempts.map(({ id, occurredAtEpochMs }) => ({
      id,
      occurredAtEpochMs,
    })),
    revision: document.revision,
  });
}

export type ReservationDecision =
  | {
      readonly allowed: true;
      readonly document: RequestBudgetDocument;
      readonly reservedAtEpochMs: number;
    }
  | {
      readonly allowed: false;
      readonly blockedUntilEpochMs: number;
    };

/**
 * Builds the next counter state. The newest durable timestamp is a logical
 * clock floor, so a wall-clock rollback cannot reopen either rolling window.
 */
export function prepareReservation(
  document: RequestBudgetDocument,
  requestedNowEpochMs: number,
  attemptId: string,
): ReservationDecision {
  if (
    !Number.isSafeInteger(requestedNowEpochMs) ||
    requestedNowEpochMs < 0 ||
    !idPattern.test(attemptId) ||
    document.revision >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError('valid epoch, attempt ID, and revision are required');
  }
  const latest = document.attempts.at(-1)?.occurredAtEpochMs ?? 0;
  const now = Math.max(requestedNowEpochMs, latest);
  const dayCutoff = now - DAY_WINDOW_MS;
  const hourCutoff = now - HOUR_WINDOW_MS;
  const retained = document.attempts.filter(
    ({ occurredAtEpochMs }) => occurredAtEpochMs > dayCutoff,
  );
  const hourly = retained.filter(
    ({ occurredAtEpochMs }) => occurredAtEpochMs > hourCutoff,
  );

  if (hourly.length >= HOURLY_REQUEST_LIMIT) {
    return {
      allowed: false,
      blockedUntilEpochMs:
        hourly[hourly.length - HOURLY_REQUEST_LIMIT].occurredAtEpochMs +
        HOUR_WINDOW_MS,
    };
  }
  if (retained.length >= DAILY_REQUEST_LIMIT) {
    return {
      allowed: false,
      blockedUntilEpochMs:
        retained[retained.length - DAILY_REQUEST_LIMIT].occurredAtEpochMs +
        DAY_WINDOW_MS,
    };
  }

  return {
    allowed: true,
    reservedAtEpochMs: now,
    document: Object.freeze({
      version: BUDGET_DOCUMENT_VERSION,
      attempts: Object.freeze([
        ...retained,
        Object.freeze({ id: attemptId, occurredAtEpochMs: now }),
      ]),
      revision: document.revision + 1,
    }),
  };
}
