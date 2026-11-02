import {
  isFiniteInRange,
  isPositiveSafeInteger,
  VALIDATION_LIMITS,
} from '../validation/limits';

const coordinateBrand: unique symbol = Symbol('validated-coordinate');
declare const providerIdBrand: unique symbol;

export interface DecimalCoordinate {
  readonly value: number;
  readonly decimal: string;
  readonly [coordinateBrand]: true;
}

export type ProviderLocationId = number & { readonly [providerIdBrand]: true };

function canonicalDecimal(value: number): string {
  // Number#toString preserves the parsed numeric value without application
  // rounding. The decimal member is used for identity and serialization.
  return Object.is(value, -0) ? '0' : value.toString();
}

function coordinate(
  input: unknown,
  minimum: number,
  maximum: number,
): DecimalCoordinate | undefined {
  let value: number;
  let decimal: string;
  if (typeof input === 'number') {
    value = input;
    decimal = canonicalDecimal(input);
  } else if (
    typeof input === 'object' &&
    input !== null &&
    Object.getPrototypeOf(input) === Object.prototype &&
    typeof (input as Record<string, unknown>).decimal === 'string'
  ) {
    decimal = (input as Record<string, unknown>).decimal as string;
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decimal)) return undefined;
    value = Number(decimal);
  } else {
    return undefined;
  }
  if (!isFiniteInRange(value, minimum, maximum)) return undefined;
  return Object.freeze({ value, decimal, [coordinateBrand]: true as const });
}

export const createLatitude = (input: unknown): DecimalCoordinate | undefined =>
  coordinate(
    input,
    VALIDATION_LIMITS.latitude.min,
    VALIDATION_LIMITS.latitude.max,
  );

export const createLongitude = (
  input: unknown,
): DecimalCoordinate | undefined =>
  coordinate(
    input,
    VALIDATION_LIMITS.longitude.min,
    VALIDATION_LIMITS.longitude.max,
  );

export function createProviderLocationId(
  input: unknown,
): ProviderLocationId | undefined {
  return isPositiveSafeInteger(input)
    ? (input as ProviderLocationId)
    : undefined;
}

export interface SearchLocationIdentity {
  readonly namespace: 'open-meteo-search';
  readonly providerId: ProviderLocationId;
  readonly latitude: DecimalCoordinate;
  readonly longitude: DecimalCoordinate;
}

export interface DeviceLocationIdentity {
  readonly namespace: 'device-coordinates';
  readonly latitude: DecimalCoordinate;
  readonly longitude: DecimalCoordinate;
}

export type LocationIdentity =
  | SearchLocationIdentity
  | DeviceLocationIdentity;

export function createSearchIdentity(input: {
  readonly providerId: unknown;
  readonly latitude: unknown;
  readonly longitude: unknown;
}): Readonly<SearchLocationIdentity> | undefined {
  const providerId = createProviderLocationId(input.providerId);
  const latitude = createLatitude(input.latitude);
  const longitude = createLongitude(input.longitude);
  return providerId && latitude && longitude
    ? Object.freeze({
        namespace: 'open-meteo-search',
        providerId,
        latitude,
        longitude,
      })
    : undefined;
}

export function createDeviceIdentity(input: {
  readonly latitude: unknown;
  readonly longitude: unknown;
}): Readonly<DeviceLocationIdentity> | undefined {
  const latitude = createLatitude(input.latitude);
  const longitude = createLongitude(input.longitude);
  return latitude && longitude
    ? Object.freeze({ namespace: 'device-coordinates', latitude, longitude })
    : undefined;
}

export function canonicalIdentity(identity: LocationIdentity): string {
  return identity.namespace === 'open-meteo-search'
    ? JSON.stringify([
        identity.namespace,
        identity.providerId,
        identity.latitude.decimal,
        identity.longitude.decimal,
      ])
    : JSON.stringify([
        identity.namespace,
        identity.latitude.decimal,
        identity.longitude.decimal,
      ]);
}

export function identitiesEqual(
  left: LocationIdentity,
  right: LocationIdentity,
): boolean {
  return canonicalIdentity(left) === canonicalIdentity(right);
}

function coordinatesEqual(
  left: LocationIdentity,
  right: LocationIdentity,
): boolean {
  return (
    left.latitude.decimal === right.latitude.decimal &&
    left.longitude.decimal === right.longitude.decimal
  );
}

export type IdentityRelationship = 'same' | 'changed-search-id' | 'distinct';

export function identityRelationship(
  existing: LocationIdentity,
  candidate: LocationIdentity,
): IdentityRelationship {
  if (identitiesEqual(existing, candidate)) return 'same';
  return existing.namespace === 'open-meteo-search' &&
    candidate.namespace === 'open-meteo-search' &&
    coordinatesEqual(existing, candidate)
    ? 'changed-search-id'
    : 'distinct';
}

/**
 * Returns the replacement identity only for an exact provider-precision
 * coordinate match with a changed search ID.
 */
export function migrateChangedSearchIdentity(
  existing: LocationIdentity,
  candidate: LocationIdentity,
): LocationIdentity | undefined {
  return identityRelationship(existing, candidate) === 'changed-search-id'
    ? candidate
    : undefined;
}
