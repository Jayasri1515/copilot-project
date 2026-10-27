import { conditionForWmoCode } from '../conditions';
import {
  createDeviceIdentity,
  createLatitude,
  createLongitude,
  createSearchIdentity,
  type LocationIdentity,
} from '../identity';
import type {
  CurrentConditions,
  Favorite,
  ForecastDay,
  LocationRef,
  PreferencesDocument,
  UnitPreference,
} from '../models';
import {
  isAcceptedString,
  isFiniteInRange,
  isWithinUtf8Limit,
  VALIDATION_LIMITS,
} from './limits';

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T }
  | { readonly valid: false; readonly reason: string };

export interface ValidatedGeocoding {
  readonly candidates: readonly LocationRef[];
  readonly rejectedCandidates: number;
}

export interface ValidatedWeatherContract {
  readonly latitude: ReturnType<typeof createLatitude> & {};
  readonly longitude: ReturnType<typeof createLongitude> & {};
  readonly timezone: string;
  readonly elevationMetres: number;
  readonly current: CurrentConditions;
  readonly daily: readonly ForecastDay[];
}

const fail = <T>(reason: string): ValidationResult<T> =>
  Object.freeze({ valid: false, reason });
const pass = <T>(value: T): ValidationResult<T> =>
  Object.freeze({ valid: true, value });

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function freeze<T extends object>(value: T): Readonly<T> {
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      freeze(item);
    }
  }
  return Object.freeze(value);
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return isAcceptedString(value) ? value : undefined;
}

export function parseJsonContract(
  body: string,
  maximumBytes: number = VALIDATION_LIMITS.providerBodyBytes,
): ValidationResult<unknown> {
  if (!isWithinUtf8Limit(body, maximumBytes)) return fail('body_too_large');
  try {
    return pass(JSON.parse(body) as unknown);
  } catch {
    return fail('malformed_json');
  }
}

export function validateGeocodingContract(
  input: unknown,
): ValidationResult<ValidatedGeocoding> {
  if (!isRecord(input)) return fail('geocoding_envelope_type');
  if (input.results === undefined) {
    return pass(freeze({ candidates: [], rejectedCandidates: 0 }));
  }
  if (!Array.isArray(input.results)) return fail('results_type');
  if (input.results.length > VALIDATION_LIMITS.geocodingResults) {
    return fail('too_many_results');
  }

  const candidates: LocationRef[] = [];
  let rejectedCandidates = 0;
  for (const candidate of input.results) {
    if (!isRecord(candidate)) {
      rejectedCandidates++;
      continue;
    }
    const city =
      isAcceptedString(candidate.name) && candidate.name.trim() !== ''
        ? candidate.name
        : undefined;
    const identity = createSearchIdentity({
      providerId: candidate.id,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    });
    const administrativeRegion = optionalString(candidate.admin1);
    const country = optionalString(candidate.country);
    const timezone = optionalString(candidate.timezone);
    const elevation =
      candidate.elevation === undefined || candidate.elevation === null
        ? null
        : isFiniteInRange(
              candidate.elevation,
              VALIDATION_LIMITS.elevationMetres.min,
              VALIDATION_LIMITS.elevationMetres.max,
            )
          ? candidate.elevation
          : undefined;
    if (
      !city ||
      !identity ||
      administrativeRegion === undefined ||
      country === undefined ||
      timezone === undefined ||
      elevation === undefined
    ) {
      rejectedCandidates++;
      continue;
    }
    candidates.push(
      freeze({
        identity,
        city,
        administrativeRegion,
        country,
        timezone,
        elevationMetres: elevation,
      }),
    );
  }
  return pass(freeze({ candidates, rejectedCandidates }));
}

function nullableNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (value === undefined || value === null) return null;
  return isFiniteInRange(value, minimum, maximum) ? value : undefined;
}

function nullableCondition(value: unknown) {
  if (value === undefined || value === null) return null;
  return conditionForWmoCode(value);
}

function validateArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) && value.length <= VALIDATION_LIMITS.dailyValues
  );
}

export function validateWeatherContract(
  input: unknown,
  expectedUnit: UnitPreference,
): ValidationResult<ValidatedWeatherContract> {
  if (!isRecord(input)) return fail('weather_envelope_type');
  const latitude = createLatitude(input.latitude);
  const longitude = createLongitude(input.longitude);
  const timezone = input.timezone;
  const elevation = input.elevation;
  if (
    !latitude ||
    !longitude ||
    !isAcceptedString(timezone) ||
    timezone.trim() === '' ||
    !isFiniteInRange(
      elevation,
      VALIDATION_LIMITS.elevationMetres.min,
      VALIDATION_LIMITS.elevationMetres.max,
    )
  ) {
    return fail('weather_location_contract');
  }
  if (
    !isRecord(input.current) ||
    !isRecord(input.current_units) ||
    !isRecord(input.daily) ||
    !isRecord(input.daily_units)
  ) {
    return fail('weather_component_contract');
  }

  const temperatureRange =
    expectedUnit === 'celsius'
      ? VALIDATION_LIMITS.celsius
      : VALIDATION_LIMITS.fahrenheit;
  const expectedTemperatureUnit = expectedUnit === 'celsius' ? '°C' : '°F';
  if (
    input.current_units.temperature_2m !== expectedTemperatureUnit ||
    input.current_units.relative_humidity_2m !== '%' ||
    input.current_units.weather_code !== 'wmo code' ||
    input.daily_units.temperature_2m_max !== expectedTemperatureUnit ||
    input.daily_units.temperature_2m_min !== expectedTemperatureUnit ||
    input.daily_units.weather_code !== 'wmo code'
  ) {
    return fail('weather_units_contract');
  }

  const temperature = nullableNumber(
    input.current.temperature_2m,
    temperatureRange.min,
    temperatureRange.max,
  );
  const humidity = nullableNumber(
    input.current.relative_humidity_2m,
    VALIDATION_LIMITS.humidity.min,
    VALIDATION_LIMITS.humidity.max,
  );
  const condition = nullableCondition(input.current.weather_code);
  if (
    temperature === undefined ||
    humidity === undefined ||
    condition === undefined
  ) {
    return fail('current_values_contract');
  }

  const daily = input.daily;
  const arrays = [
    daily.time,
    daily.weather_code,
    daily.temperature_2m_max,
    daily.temperature_2m_min,
  ];
  if (!arrays.every(validateArray)) return fail('daily_array_contract');
  const times = daily.time as unknown[];
  const codes = daily.weather_code as unknown[];
  const maximums = daily.temperature_2m_max as unknown[];
  const minimums = daily.temperature_2m_min as unknown[];
  const lengths = arrays.map((value) => value.length);
  if (!lengths.every((length) => length === lengths[0])) {
    return fail('daily_array_alignment');
  }

  const days: ForecastDay[] = [];
  for (let index = 0; index < lengths[0]; index++) {
    const date = times[index];
    const code = nullableCondition(codes[index]);
    const maximum = nullableNumber(
      maximums[index],
      temperatureRange.min,
      temperatureRange.max,
    );
    const minimum = nullableNumber(
      minimums[index],
      temperatureRange.min,
      temperatureRange.max,
    );
    if (
      !isAcceptedString(date) ||
      code === undefined ||
      maximum === undefined ||
      minimum === undefined
    ) {
      return fail('daily_value_contract');
    }
    days.push(
      freeze({
        date,
        temperatureMax: maximum,
        temperatureMin: minimum,
        condition: code,
      }),
    );
  }

  return pass(
    freeze({
      latitude,
      longitude,
      timezone,
      elevationMetres: elevation,
      current: freeze({
        temperature,
        humidityPercent: humidity,
        condition,
      }),
      daily: days,
    }) as ValidatedWeatherContract,
  );
}

const preferenceEnvelopeKeys = new Set(['version', 'unit', 'favorites']);
const favoriteKeys = new Set([
  'namespace',
  'providerId',
  'latitude',
  'longitude',
  'city',
  'administrativeRegion',
  'country',
]);

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function storedIdentity(value: Record<string, unknown>): LocationIdentity | undefined {
  if (value.namespace === 'open-meteo-search') {
    return createSearchIdentity({
      providerId: value.providerId,
      latitude: { decimal: value.latitude },
      longitude: { decimal: value.longitude },
    });
  }
  if (
    value.namespace === 'device-coordinates' &&
    value.providerId === undefined
  ) {
    return createDeviceIdentity({
      latitude: { decimal: value.latitude },
      longitude: { decimal: value.longitude },
    });
  }
  return undefined;
}

export function validatePreferencesContract(
  input: unknown,
): ValidationResult<PreferencesDocument> {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, preferenceEnvelopeKeys) ||
    input.version !== 1 ||
    (input.unit !== 'celsius' && input.unit !== 'fahrenheit') ||
    !Array.isArray(input.favorites)
  ) {
    return fail('preferences_envelope_contract');
  }
  const favorites: Favorite[] = [];
  for (const entry of input.favorites) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, favoriteKeys)) {
      return fail('favorite_contract');
    }
    const identity = storedIdentity(entry);
    const region = optionalString(entry.administrativeRegion);
    const country = optionalString(entry.country);
    if (
      !identity ||
      !isAcceptedString(entry.city) ||
      entry.city.trim() === '' ||
      region === undefined ||
      country === undefined
    ) {
      return fail('favorite_contract');
    }
    favorites.push(
      freeze({
        identity,
        city: entry.city,
        administrativeRegion: region,
        country,
      }),
    );
  }
  return pass(
    freeze({ version: 1, unit: input.unit, favorites }) as PreferencesDocument,
  );
}

export function parsePreferencesDocument(
  body: string,
): ValidationResult<PreferencesDocument> {
  const parsed = parseJsonContract(
    body,
    VALIDATION_LIMITS.storageDocumentBytes,
  );
  return parsed.valid ? validatePreferencesContract(parsed.value) : parsed;
}
