import { describe, expect, it } from 'vitest';
import { prepareForecast } from '../../../src/domain/forecast';
import {
  formatForecastDate,
  formatRetrievalTime,
  formatTemperature,
  roundTemperatureForDisplay,
  unitSemantic,
} from '../../../src/domain/formatting';
import {
  canonicalIdentity,
  createDeviceIdentity,
  createSearchIdentity,
  identitiesEqual,
  identityRelationship,
  migrateChangedSearchIdentity,
} from '../../../src/domain/identity';

const day = (
  date: string,
  temperatureMax = 10,
  temperatureMin = 2,
  code = 0,
) => ({
  date,
  temperatureMax,
  temperatureMin,
  condition: { code, description: 'Clear sky', iconKey: 'clear' },
});

describe('location-local forecast policy', () => {
  it('excludes today on opposite sides of location-local midnight', () => {
    const instant = Date.parse('2026-10-27T18:45:00Z');
    const kolkata = prepareForecast(
      [day('2026-10-28'), day('2026-10-29'), day('2026-10-30')],
      'Asia/Kolkata',
      instant,
    );
    const losAngeles = prepareForecast(
      [day('2026-10-27'), day('2026-10-28'), day('2026-10-29')],
      'America/Los_Angeles',
      instant,
    );
    expect(kolkata.available && kolkata.today).toBe('2026-10-28');
    expect(
      kolkata.available && kolkata.slots.map((slot) => slot.date),
    ).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
    expect(losAngeles.available && losAngeles.today).toBe('2026-10-27');
  });

  it('uses consecutive calendar dates across DST transitions', () => {
    const result = prepareForecast(
      [day('2026-03-08'), day('2026-03-09'), day('2026-03-10')],
      'America/New_York',
      Date.parse('2026-03-08T04:30:00Z'),
    );
    expect(result.available && result.today).toBe('2026-03-07');
    expect(result.available && result.slots.map(({ date }) => date)).toEqual([
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('rejects impossible/malformed records and conflicting duplicates', () => {
    const identical = day('2026-10-28');
    const result = prepareForecast(
      [
        day('2026-10-30'),
        identical,
        { ...identical },
        day('2026-10-29', 11),
        day('2026-10-29', 12),
        day('2026-02-30'),
        { date: 'not-a-date', temperatureMax: 1 },
      ],
      'UTC',
      Date.parse('2026-10-27T12:00:00Z'),
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.slots.map((slot) => [slot.date, slot.forecast?.date ?? null]))
      .toEqual([
        ['2026-10-28', '2026-10-28'],
        ['2026-10-29', null],
        ['2026-10-30', '2026-10-30'],
      ]);
    expect(result.rejectedRecords).toBe(4);
  });

  it('does not substitute a later date for a gap', () => {
    const result = prepareForecast(
      [day('2026-10-28'), day('2026-10-30'), day('2026-10-31')],
      'UTC',
      Date.parse('2026-10-27T12:00:00Z'),
    );
    expect(
      result.available &&
        result.slots.map((slot) => slot.forecast?.date ?? null),
    ).toEqual(['2026-10-28', null, '2026-10-30']);
  });

  it.each([null, '', 'Not/A_Timezone'])(
    'marks missing or malformed timezone %s unavailable',
    (timezone) => {
      expect(prepareForecast([], timezone, Date.now())).toEqual({
        available: false,
        reason: 'invalid_timezone',
      });
    },
  );
});

describe('unit and locale formatting policies', () => {
  it.each([
    [2.5, 3],
    [-2.5, -3],
    [2.49, 2],
    [-2.49, -2],
  ])('rounds %s half-away-from-zero to %s', (value, expected) => {
    expect(roundTemperatureForDisplay(value)).toBe(expected);
  });

  it('keeps Celsius and Fahrenheit as request/display semantics, not conversions', () => {
    expect(unitSemantic('celsius')).toMatchObject({
      providerParameter: 'celsius',
      symbol: '°C',
    });
    expect(unitSemantic('fahrenheit')).toMatchObject({
      providerParameter: 'fahrenheit',
      symbol: '°F',
    });
    expect(formatTemperature(2.5, 'celsius', 'en-US')).toBe('3 °C');
    expect(formatTemperature(2.5, 'fahrenheit', 'en-US')).toBe('3 °F');
  });

  it('formats validated values for multiple locales without mutating them', () => {
    const value = 1234.49;
    const date = '2026-10-28';
    const us = formatTemperature(value, 'celsius', 'en-US');
    const german = formatTemperature(value, 'celsius', 'de-DE');
    expect(us).toBe('1,234 °C');
    expect(german).toBe('1.234 °C');
    expect(formatForecastDate(date, 'en-US')).not.toBe(
      formatForecastDate(date, 'de-DE'),
    );
    expect(value).toBe(1234.49);
    expect(date).toBe('2026-10-28');
  });

  it('formats retrieval instants in the selected timezone only', () => {
    const instant = Date.parse('2026-10-27T23:30:00Z');
    const utc = formatRetrievalTime(instant, 'UTC', 'en-US');
    const tokyo = formatRetrievalTime(instant, 'Asia/Tokyo', 'en-US');
    expect(utc).not.toBe(tokyo);
    expect(formatRetrievalTime(instant, 'invalid/timezone', 'en-US')).toBeUndefined();
  });
});

describe('canonical identity and changed-ID migration', () => {
  const search = (id: number, latitude: unknown = { decimal: '19.07283' }) =>
    createSearchIdentity({
      providerId: id,
      latitude,
      longitude: { decimal: '72.88261' },
    })!;

  it('rejects ID-less search and keeps device identities namespaced', () => {
    expect(
      createSearchIdentity({ providerId: undefined, latitude: 1, longitude: 2 }),
    ).toBeUndefined();
    const device = createDeviceIdentity({ latitude: 1, longitude: 2 })!;
    expect(device.namespace).toBe('device-coordinates');
    expect(canonicalIdentity(device)).toContain('device-coordinates');
    expect(identitiesEqual(device, search(1))).toBe(false);
  });

  it('uses namespace, ID, and exact coordinate representations for equality', () => {
    expect(identitiesEqual(search(1), search(1))).toBe(true);
    expect(identitiesEqual(search(1), search(2))).toBe(false);
    expect(identitiesEqual(search(1), search(1, { decimal: '19.072830' }))).toBe(false);
  });

  it('migrates a changed ID only when coordinates match exactly', () => {
    const existing = search(1);
    const changed = search(2);
    const mismatch = search(3, { decimal: '19.072830' });
    expect(identityRelationship(existing, changed)).toBe('changed-search-id');
    expect(migrateChangedSearchIdentity(existing, changed)).toBe(changed);
    expect(identityRelationship(existing, mismatch)).toBe('distinct');
    expect(migrateChangedSearchIdentity(existing, mismatch)).toBeUndefined();
  });

  it('never treats device coordinates as a changed search identity', () => {
    const device = createDeviceIdentity({
      latitude: { decimal: '19.07283' },
      longitude: { decimal: '72.88261' },
    })!;
    expect(identityRelationship(device, search(2))).toBe('distinct');
  });
});
