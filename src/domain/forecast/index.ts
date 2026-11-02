import type { ForecastDay } from '../models';

export interface ForecastSlot {
  readonly date: string;
  readonly forecast: Readonly<ForecastDay> | null;
}

export type PreparedForecast =
  | {
      readonly available: false;
      readonly reason: 'invalid_timezone' | 'invalid_instant';
    }
  | {
      readonly available: true;
      readonly today: string;
      readonly slots: readonly ForecastSlot[];
      readonly rejectedRecords: number;
    };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcCalendarDate(year: number, month: number, day: number): Date {
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year, month - 1, day);
  return value;
}

export function parseCalendarDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const match = DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = utcCalendarDate(year, month, day);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? parsed
    : undefined;
}

function calendarDateString(value: Date): string {
  const year = String(value.getUTCFullYear()).padStart(4, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextCalendarDate(value: string, offset: number): string {
  const date = parseCalendarDate(value);
  if (!date) throw new Error('A validated calendar date was expected.');
  date.setUTCDate(date.getUTCDate() + offset);
  return calendarDateString(date);
}

function localCalendarDate(
  instant: Date,
  timezone: string,
): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((candidate) => candidate.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    const date = year && month && day ? `${year}-${month}-${day}` : undefined;
    return date && parseCalendarDate(date) ? date : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isCondition(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      Number.isInteger(value.code) &&
      typeof value.description === 'string' &&
      typeof value.iconKey === 'string')
  );
}

function validatedForecastDay(value: unknown): Readonly<ForecastDay> | undefined {
  if (
    !isRecord(value) ||
    !parseCalendarDate(value.date) ||
    !isNullableFiniteNumber(value.temperatureMax) ||
    !isNullableFiniteNumber(value.temperatureMin) ||
    !isCondition(value.condition)
  ) {
    return undefined;
  }
  return value as unknown as Readonly<ForecastDay>;
}

function sameCondition(
  left: ForecastDay['condition'],
  right: ForecastDay['condition'],
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.code === right.code &&
      left.description === right.description &&
      left.iconKey === right.iconKey)
  );
}

function sameForecast(left: ForecastDay, right: ForecastDay): boolean {
  return (
    left.date === right.date &&
    Object.is(left.temperatureMax, right.temperatureMax) &&
    Object.is(left.temperatureMin, right.temperatureMin) &&
    sameCondition(left.condition, right.condition)
  );
}

/**
 * Prepares the three location-local calendar dates after today. The input is
 * treated as untrusted at this policy boundary; malformed records are skipped
 * and conflicting duplicates invalidate their date.
 */
export function prepareForecast(
  records: readonly unknown[],
  timezone: unknown,
  now: Date | number,
): PreparedForecast {
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    return Object.freeze({ available: false, reason: 'invalid_timezone' });
  }
  const instant = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(instant.getTime())) {
    return Object.freeze({ available: false, reason: 'invalid_instant' });
  }
  const today = localCalendarDate(instant, timezone);
  if (!today) {
    return Object.freeze({ available: false, reason: 'invalid_timezone' });
  }

  const byDate = new Map<string, Readonly<ForecastDay>>();
  const conflicts = new Set<string>();
  let rejectedRecords = 0;
  for (const input of records) {
    const record = validatedForecastDay(input);
    if (!record) {
      rejectedRecords++;
      continue;
    }
    if (conflicts.has(record.date)) {
      rejectedRecords++;
      continue;
    }
    const existing = byDate.get(record.date);
    if (!existing) {
      byDate.set(record.date, record);
    } else if (!sameForecast(existing, record)) {
      byDate.delete(record.date);
      conflicts.add(record.date);
      rejectedRecords += 2;
    }
  }

  const slots = Object.freeze(
    [1, 2, 3].map((offset) => {
      const date = nextCalendarDate(today, offset);
      return Object.freeze({ date, forecast: byDate.get(date) ?? null });
    }),
  );
  return Object.freeze({ available: true, today, slots, rejectedRecords });
}
