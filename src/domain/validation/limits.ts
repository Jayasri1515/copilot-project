export const VALIDATION_LIMITS = Object.freeze({
  providerBodyBytes: 1_048_576,
  storageDocumentBytes: 262_144,
  stringCharacters: 200,
  geocodingResults: 20,
  dailyValues: 16,
  latitude: Object.freeze({ min: -90, max: 90 }),
  longitude: Object.freeze({ min: -180, max: 180 }),
  celsius: Object.freeze({ min: -100, max: 70 }),
  fahrenheit: Object.freeze({ min: -148, max: 158 }),
  humidity: Object.freeze({ min: 0, max: 100 }),
  elevationMetres: Object.freeze({ min: -500, max: 9_000 }),
  wmoCode: Object.freeze({ min: 0, max: 99 }),
} as const);

export const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

export function isWithinUtf8Limit(value: string, maximumBytes: number): boolean {
  return utf8ByteLength(value) <= maximumBytes;
}

export function isAcceptedString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Array.from(value).length <= VALIDATION_LIMITS.stringCharacters
  );
}

export function isFiniteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}
