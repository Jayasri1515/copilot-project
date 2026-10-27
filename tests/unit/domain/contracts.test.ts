import { describe, expect, it } from 'vitest';
import {
  conditionForWmoCode,
  WMO_CONDITIONS,
} from '../../../src/domain/conditions';
import {
  createDeviceIdentity,
  createLatitude,
  createLongitude,
  createProviderLocationId,
  createSearchIdentity,
} from '../../../src/domain/identity';
import {
  parseJsonContract,
  parsePreferencesDocument,
  validateGeocodingContract,
  validatePreferencesContract,
  validateWeatherContract,
} from '../../../src/domain/validation/contracts';
import {
  isAcceptedString,
  isFiniteInRange,
  VALIDATION_LIMITS,
} from '../../../src/domain/validation/limits';
import {
  geocodingContractFixtures,
  validGeocodingFixture,
} from '../../fixtures/geocoding/contracts';
import {
  corruptStorageFixture,
  futureVersionStorageFixture,
  mixedInvalidV1StorageFixture,
  validV1StorageFixture,
} from '../../fixtures/storage/contracts';
import {
  documentedWmoCodesFixture,
  unknownValidWmoCodeFixture,
  validWeatherFixture,
  weatherContractFixtures,
} from '../../fixtures/weather/contracts';

const weather = (overrides: Record<string, unknown> = {}) => ({
  ...validWeatherFixture,
  ...overrides,
});

const weatherWithCurrent = (
  current: Record<string, unknown>,
  unit: 'celsius' | 'fahrenheit' = 'celsius',
) => {
  const symbol = unit === 'celsius' ? '°C' : '°F';
  return weather({
    current_units: { ...validWeatherFixture.current_units, temperature_2m: symbol },
    daily_units: {
      ...validWeatherFixture.daily_units,
      temperature_2m_max: symbol,
      temperature_2m_min: symbol,
    },
    current: { ...validWeatherFixture.current, ...current },
  });
};

describe('UTF-8 and string boundaries', () => {
  it('accepts exactly 1 MiB and rejects one byte more before decoding', () => {
    const atLimit = `"${'a'.repeat(VALIDATION_LIMITS.providerBodyBytes - 2)}"`;
    const overLimit = `${atLimit} `;
    expect(parseJsonContract(atLimit).valid).toBe(true);
    expect(parseJsonContract(overLimit)).toEqual({
      valid: false,
      reason: 'body_too_large',
    });
  });

  it('measures multi-byte input as UTF-8 bytes', () => {
    const body = `"${'é'.repeat(524_287)}"`; // 1,048,576 UTF-8 bytes
    expect(parseJsonContract(body).valid).toBe(true);
    expect(parseJsonContract(`${body} `).valid).toBe(false);
  });

  it('accepts 200 Unicode characters and rejects 201', () => {
    expect(isAcceptedString('😀'.repeat(200))).toBe(true);
    expect(isAcceptedString('😀'.repeat(201))).toBe(false);
    const at = validateGeocodingContract({
      results: [{ id: 1, name: 'x'.repeat(200), latitude: 0, longitude: 0 }],
    });
    const over = validateGeocodingContract({
      results: [{ id: 1, name: 'x'.repeat(201), latitude: 0, longitude: 0 }],
    });
    expect(at.valid && at.value.candidates).toHaveLength(1);
    expect(over.valid && over.value.rejectedCandidates).toBe(1);
  });

  it('accepts an exactly 256 KiB storage JSON and rejects one byte more', () => {
    const document = {
      version: 1,
      unit: 'celsius',
      favorites: [
        {
          namespace: 'device-coordinates',
          latitude: '1',
          longitude: '2',
          city: 'é',
          administrativeRegion: null,
          country: null,
        },
      ],
    };
    const base = JSON.stringify(document);
    const baseBytes = new TextEncoder().encode(base).byteLength;
    const atLimit =
      base + ' '.repeat(VALIDATION_LIMITS.storageDocumentBytes - baseBytes);
    expect(parsePreferencesDocument(atLimit).valid).toBe(true);
    expect(parsePreferencesDocument(`${atLimit} `)).toEqual({
      valid: false,
      reason: 'body_too_large',
    });
  });

  it('applies the 200/201 character boundary to stored text', () => {
    const stored = (city: string) => ({
      version: 1,
      unit: 'celsius',
      favorites: [
        {
          namespace: 'device-coordinates',
          latitude: '1',
          longitude: '2',
          city,
          administrativeRegion: null,
          country: null,
        },
      ],
    });
    expect(validatePreferencesContract(stored('x'.repeat(200))).valid).toBe(true);
    expect(validatePreferencesContract(stored('x'.repeat(201))).valid).toBe(false);
  });
});

describe('numeric and count boundaries', () => {
  it.each([
    [-90, -90, 90, true],
    [90, -90, 90, true],
    [-90.0001, -90, 90, false],
    [90.0001, -90, 90, false],
    [-180, -180, 180, true],
    [180, -180, 180, true],
    [-180.0001, -180, 180, false],
    [180.0001, -180, 180, false],
    [0, 0, 100, true],
    [100, 0, 100, true],
    [-0.0001, 0, 100, false],
    [100.0001, 0, 100, false],
    [-500, -500, 9000, true],
    [9000, -500, 9000, true],
    [-500.0001, -500, 9000, false],
    [9000.0001, -500, 9000, false],
  ])('range value %s in [%s,%s] has accepted=%s', (value, min, max, accepted) => {
    expect(isFiniteInRange(value, min, max)).toBe(accepted);
  });

  it('rejects non-finite numeric values', () => {
    expect(isFiniteInRange(Number.NaN, -90, 90)).toBe(false);
    expect(isFiniteInRange(Infinity, -90, 90)).toBe(false);
    expect(isFiniteInRange('1', -90, 90)).toBe(false);
  });

  it.each([
    [1, true],
    [Number.MAX_SAFE_INTEGER, true],
    [0, false],
    [-1, false],
    [1.1, false],
    [Number.MAX_SAFE_INTEGER + 1, false],
  ])('validates positive safe provider ID %s as %s', (id, accepted) => {
    expect(createProviderLocationId(id) !== undefined).toBe(accepted);
  });

  it('accepts 20 geocoding results and rejects 21', () => {
    const candidate = { id: 1, name: 'City', latitude: 0, longitude: 0 };
    expect(
      validateGeocodingContract({ results: Array(20).fill(candidate) }).valid,
    ).toBe(true);
    expect(
      validateGeocodingContract({ results: Array(21).fill(candidate) }),
    ).toEqual({ valid: false, reason: 'too_many_results' });
  });

  it('accepts daily arrays of 16 and rejects 17', () => {
    const daily = (length: number) => ({
      time: Array.from({ length }, (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`),
      weather_code: Array(length).fill(0),
      temperature_2m_max: Array(length).fill(10),
      temperature_2m_min: Array(length).fill(0),
    });
    expect(validateWeatherContract(weather({ daily: daily(16) }), 'celsius').valid).toBe(true);
    expect(validateWeatherContract(weather({ daily: daily(17) }), 'celsius')).toEqual({
      valid: false,
      reason: 'daily_array_contract',
    });
  });

  it.each([
    ['celsius', -100, true],
    ['celsius', 70, true],
    ['celsius', -100.0001, false],
    ['celsius', 70.0001, false],
    ['fahrenheit', -148, true],
    ['fahrenheit', 158, true],
    ['fahrenheit', -148.0001, false],
    ['fahrenheit', 158.0001, false],
  ] as const)('validates %s temperature boundary %s', (unit, value, accepted) => {
    expect(
      validateWeatherContract(
        weatherWithCurrent({ temperature_2m: value }, unit),
        unit,
      ).valid,
    ).toBe(accepted);
  });

  it.each([
    ['latitude', -90, true],
    ['latitude', 90, true],
    ['latitude', -90.0001, false],
    ['latitude', 90.0001, false],
    ['longitude', -180, true],
    ['longitude', 180, true],
    ['longitude', -180.0001, false],
    ['longitude', 180.0001, false],
    ['elevation', -500, true],
    ['elevation', 9000, true],
    ['elevation', -500.0001, false],
    ['elevation', 9000.0001, false],
  ])('validates weather %s boundary %s', (field, value, accepted) => {
    expect(validateWeatherContract(weather({ [field]: value }), 'celsius').valid).toBe(accepted);
  });

  it.each([
    [0, true],
    [100, true],
    [-0.0001, false],
    [100.0001, false],
  ])('validates humidity boundary %s', (value, accepted) => {
    expect(
      validateWeatherContract(
        weatherWithCurrent({ relative_humidity_2m: value }),
        'celsius',
      ).valid,
    ).toBe(accepted);
  });
});

describe('canonical identities', () => {
  it('preserves coordinate decimal identity without rounding', () => {
    const latitude = createLatitude({ decimal: '19.072830001' });
    const longitude = createLongitude({ decimal: '-0.0000001' });
    expect(latitude).toMatchObject({ value: 19.072830001, decimal: '19.072830001' });
    expect(longitude).toMatchObject({ value: -0.0000001, decimal: '-0.0000001' });
    expect(Object.isFrozen(latitude)).toBe(true);
  });

  it('uses separate search and device namespaces and rejects ID-less search', () => {
    expect(createSearchIdentity({ providerId: undefined, latitude: 1, longitude: 2 })).toBeUndefined();
    expect(createSearchIdentity({ providerId: 1, latitude: 1, longitude: 2 })?.namespace).toBe('open-meteo-search');
    expect(createDeviceIdentity({ latitude: 1, longitude: 2 })?.namespace).toBe('device-coordinates');
    expect(createLongitude({ decimal: '01.0' })).toBeUndefined();
  });
});

describe('WMO semantic mapping', () => {
  it('has an immutable fixture for every documented mapping branch', () => {
    expect(documentedWmoCodesFixture).toEqual(
      Object.keys(WMO_CONDITIONS).map(Number),
    );
    expect(Object.isFrozen(documentedWmoCodesFixture)).toBe(true);
  });

  it.each(
    Object.entries(WMO_CONDITIONS).map(([code, semantic]) => [
      Number(code),
      semantic.description,
      semantic.iconKey,
    ]),
  )('maps WMO %s to %s / %s', (code, description, iconKey) => {
    expect(conditionForWmoCode(code)).toEqual({ code, description, iconKey });
  });

  it('maps an unknown valid integer and rejects invalid code boundaries', () => {
    expect(conditionForWmoCode(unknownValidWmoCodeFixture)).toEqual({
      code: 4,
      description: 'Unknown conditions',
      iconKey: 'unknown',
    });
    expect(conditionForWmoCode(0)?.code).toBe(0);
    expect(conditionForWmoCode(99)?.code).toBe(99);
    expect(conditionForWmoCode(-1)).toBeUndefined();
    expect(conditionForWmoCode(100)).toBeUndefined();
    expect(conditionForWmoCode(1.5)).toBeUndefined();
  });
});

describe('provider contracts', () => {
  it('validates provider-neutral candidates and missing display fields', () => {
    const result = validateGeocodingContract(validGeocodingFixture);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.candidates).toHaveLength(2);
    expect(result.value.candidates[1]).toMatchObject({
      administrativeRegion: null,
      country: null,
    });
    expect(Object.isFrozen(result.value.candidates[0])).toBe(true);
  });

  it('rejects malformed JSON and wrong required types without coercion', () => {
    expect(parseJsonContract(geocodingContractFixtures.malformedJson)).toEqual({
      valid: false,
      reason: 'malformed_json',
    });
    expect(validateGeocodingContract(geocodingContractFixtures.wrongResultsType).valid).toBe(false);
    expect(validateGeocodingContract(geocodingContractFixtures.wrongIdType)).toMatchObject({
      valid: true,
      value: { rejectedCandidates: 1 },
    });
    expect(validateWeatherContract(weatherContractFixtures.wrongType, 'celsius').valid).toBe(false);
    expect(validateWeatherContract(weatherContractFixtures.missingRequired, 'celsius').valid).toBe(false);
    expect(parseJsonContract(weatherContractFixtures.malformedJson).valid).toBe(false);
  });

  it('ignores unknown extra provider fields after known fields validate', () => {
    expect(validateGeocodingContract(geocodingContractFixtures.extraField).valid).toBe(true);
    expect(validateWeatherContract(weatherContractFixtures.extraField, 'celsius').valid).toBe(true);
  });

  it('rejects misaligned and wrong-type daily contracts', () => {
    expect(
      validateWeatherContract(
        weather({ daily: { ...validWeatherFixture.daily, weather_code: [0] } }),
        'celsius',
      ),
    ).toEqual({ valid: false, reason: 'daily_array_alignment' });
    expect(
      validateWeatherContract(
        weather({ daily: { ...validWeatherFixture.daily, time: '2026-01-01' } }),
        'celsius',
      ).valid,
    ).toBe(false);
  });
});

describe('storage contract fixtures', () => {
  it('validates the immutable v1 fixture and precision-preserving strings', () => {
    const result = validatePreferencesContract(validV1StorageFixture);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.favorites[0].identity.latitude.decimal).toBe('19.07283');
    expect(Object.isFrozen(validV1StorageFixture)).toBe(true);
    expect(Object.isFrozen(validV1StorageFixture.favorites[0])).toBe(true);
  });

  it('identifies mixed-invalid, corrupt, and future-version fixture schemas', () => {
    expect(validatePreferencesContract(mixedInvalidV1StorageFixture).valid).toBe(false);
    expect(parsePreferencesDocument(corruptStorageFixture)).toEqual({
      valid: false,
      reason: 'malformed_json',
    });
    expect(validatePreferencesContract(futureVersionStorageFixture)).toEqual({
      valid: false,
      reason: 'preferences_envelope_contract',
    });
  });

  it('rejects prohibited extra storage fields and wrong types', () => {
    expect(
      validatePreferencesContract({
        ...validV1StorageFixture,
        weather: { temperature: 20 },
      }).valid,
    ).toBe(false);
    expect(
      validatePreferencesContract({
        version: 1,
        unit: 'celsius',
        favorites: [{ ...validV1StorageFixture.favorites[0], searchHistory: [] }],
      }).valid,
    ).toBe(false);
    expect(
      validatePreferencesContract({ version: 1, unit: 1, favorites: [] }).valid,
    ).toBe(false);
  });
});
