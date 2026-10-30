import type { UnitPreference } from '../models';
import { parseCalendarDate } from '../forecast';

export interface UnitSemantic {
  readonly preference: UnitPreference;
  readonly providerParameter: 'celsius' | 'fahrenheit';
  readonly symbol: '°C' | '°F';
}

const UNIT_SEMANTICS: Readonly<Record<UnitPreference, UnitSemantic>> =
  Object.freeze({
    celsius: Object.freeze({
      preference: 'celsius',
      providerParameter: 'celsius',
      symbol: '°C',
    }),
    fahrenheit: Object.freeze({
      preference: 'fahrenheit',
      providerParameter: 'fahrenheit',
      symbol: '°F',
    }),
  });

export function unitSemantic(unit: UnitPreference): UnitSemantic {
  return UNIT_SEMANTICS[unit];
}

export function roundTemperatureForDisplay(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('Temperature must be finite.');
  }
  const rounded = Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatTemperature(
  value: number,
  unit: UnitPreference,
  locales?: Intl.LocalesArgument,
): string {
  const rounded = roundTemperatureForDisplay(value);
  const number = new Intl.NumberFormat(locales, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(rounded);
  return `${number} ${unitSemantic(unit).symbol}`;
}

/**
 * A forecast date is already a selected-location local calendar date. Format
 * its fields in UTC so Intl cannot shift that validated calendar date.
 */
export function formatForecastDate(
  date: string,
  locales?: Intl.LocalesArgument,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  },
): string | undefined {
  const parsed = parseCalendarDate(date);
  if (!parsed) return undefined;
  return new Intl.DateTimeFormat(locales, {
    ...options,
    timeZone: 'UTC',
  }).format(parsed);
}

export function formatRetrievalTime(
  instant: Date | number,
  timezone: unknown,
  locales?: Intl.LocalesArgument,
): string | undefined {
  if (typeof timezone !== 'string' || timezone.trim() === '') return undefined;
  const date = instant instanceof Date ? new Date(instant.getTime()) : new Date(instant);
  if (!Number.isFinite(date.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat(locales, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(date);
  } catch {
    return undefined;
  }
}
