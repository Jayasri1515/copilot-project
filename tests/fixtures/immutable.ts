export function immutableFixture<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      immutableFixture(child);
    }
    Object.freeze(value);
  }
  return value;
}
