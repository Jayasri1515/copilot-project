import { describe, expect, it, vi } from 'vitest';
import {
  PREFERENCES_STORAGE_KEY,
  PreferencesRepository,
  SESSION_STORAGE_WARNING,
  deserializePreferences,
  serializePreferences,
} from '../../../src/adapters/storage';
import { addFavorite, defaultPreferences, selectUnit } from '../../../src/application/favorites';
import { createSearchIdentity } from '../../../src/domain/identity';
import type { Favorite, PreferencesDocument } from '../../../src/domain/models';
import { VALIDATION_LIMITS } from '../../../src/domain/validation/limits';
import {
  corruptStorageFixture,
  futureVersionStorageFixture,
  mixedInvalidV1StorageFixture,
  validV1StorageFixture,
} from '../../fixtures/storage/contracts';

class FakeStorage implements Storage {
  readonly values = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    if (this.throwOnGet) throw new DOMException('blocked', 'SecurityError');
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new DOMException('quota', 'QuotaExceededError');
    this.values.set(key, value);
  }
}

const fixtureBody = (fixture: unknown): string => JSON.stringify(fixture);

function favorite(id: number, city = 'Mumbai'): Favorite {
  const identity = createSearchIdentity({
    providerId: id,
    latitude: { decimal: '19.07283' },
    longitude: { decimal: '72.88261' },
  });
  if (!identity) throw new Error('invalid test identity');
  return {
    identity,
    city,
    administrativeRegion: 'Maharashtra',
    country: 'India',
  };
}

function storageEvent(key: string, newValue: string | null): Event {
  const event = new Event('storage');
  Object.defineProperties(event, {
    key: { value: key },
    newValue: { value: newValue },
    storageArea: { value: null },
  });
  return event;
}

describe('schema-v1 preferences document', () => {
  it('loads valid v1 and independently retains valid mixed entries', () => {
    const valid = deserializePreferences(fixtureBody(validV1StorageFixture));
    expect(valid.complete).toBe(true);
    expect(valid.document.favorites).toHaveLength(2);
    expect(valid.document.favorites[0].identity.latitude.decimal).toBe('19.07283');

    const mixed = deserializePreferences(fixtureBody(mixedInvalidV1StorageFixture));
    expect(mixed.complete).toBe(false);
    expect(mixed.document.unit).toBe('fahrenheit');
    expect(mixed.document.favorites.map(({ city }) => city)).toEqual(['Mumbai']);
    expect(mixed.notices).toEqual(['favorite_1_reset']);
  });

  it('does not infer corrupt JSON or unsupported future versions', () => {
    for (const body of [
      corruptStorageFixture,
      fixtureBody(futureVersionStorageFixture),
    ]) {
      const result = deserializePreferences(body);
      expect(result.document).toEqual(defaultPreferences());
      expect(result.notices).toEqual(['preferences_document_reset']);
    }
  });

  it('falls back only an invalid unit to Celsius', () => {
    const result = deserializePreferences(
      JSON.stringify({ ...validV1StorageFixture, unit: 'kelvin' }),
    );
    expect(result.document.unit).toBe('celsius');
    expect(result.document.favorites).toHaveLength(2);
    expect(result.notices).toEqual(['preferences_unit_reset']);
  });

  it('rejects prototype/extra fields and strips prohibited fields on write', () => {
    expect(
      deserializePreferences(
        '{"version":1,"unit":"celsius","favorites":[],"__proto__":{}}',
      ).complete,
    ).toBe(false);
    const withProhibitedRuntimeFields = {
      ...addFavorite(defaultPreferences(), favorite(1)),
      weather: { temperature: 20 },
      searchHistory: ['secret'],
    } as PreferencesDocument;
    const serialized = serializePreferences(withProhibitedRuntimeFields);
    expect(serialized).not.toContain('weather');
    expect(serialized).not.toContain('searchHistory');
    expect(Object.keys(JSON.parse(serialized) as object)).toEqual([
      'version',
      'unit',
      'favorites',
    ]);
  });

  it('accepts exactly 256 KiB and rejects the next UTF-8 byte', () => {
    const base = '{"version":1,"unit":"celsius","favorites":[]}';
    const exact = `${base}${' '.repeat(
      VALIDATION_LIMITS.storageDocumentBytes - base.length,
    )}`;
    expect(deserializePreferences(exact).complete).toBe(true);
    const oversized = `${exact}é`;
    expect(deserializePreferences(oversized).complete).toBe(false);
    expect(deserializePreferences(oversized).notices).toEqual([
      'preferences_document_reset',
    ]);
  });
});

describe('PreferencesRepository contract', () => {
  it('loads fixtures and reports each invalid entry reset', async () => {
    const storage = new FakeStorage();
    storage.setItem(
      PREFERENCES_STORAGE_KEY,
      fixtureBody(mixedInvalidV1StorageFixture),
    );
    const repository = new PreferencesRepository({ storage });
    const result = await repository.load();
    expect(result.kind).toBe('partial');
    if (result.kind !== 'partial') return;
    expect(result.value.favorites).toHaveLength(1);
    expect(result.unavailable).toEqual(['favorite_1_reset']);
  });

  it('uses session memory with a persistent warning when reads are inaccessible', async () => {
    const storage = new FakeStorage();
    storage.throwOnGet = true;
    const repository = new PreferencesRepository({ storage });
    const loaded = await repository.load();
    expect(loaded.kind === 'partial' && loaded.unavailable).toContain(
      SESSION_STORAGE_WARNING,
    );
    const changed = addFavorite(defaultPreferences(), favorite(1));
    const replaced = await repository.replace(changed);
    expect(replaced.kind).toBe('partial');
    expect(
      replaced.kind === 'partial' && replaced.value.favorites,
    ).toHaveLength(1);
    const reloaded = await repository.load();
    expect(reloaded.kind === 'partial' && reloaded.unavailable).toContain(
      SESSION_STORAGE_WARNING,
    );
    expect(reloaded.kind === 'partial' && reloaded.value.favorites).toHaveLength(1);
  });

  it('detects private-mode storage that allows reads but rejects writes', async () => {
    const storage = new FakeStorage();
    storage.throwOnSet = true;
    const repository = new PreferencesRepository({ storage });
    const loaded = await repository.load();
    expect(loaded.kind === 'partial' && loaded.unavailable).toContain(
      SESSION_STORAGE_WARNING,
    );
    expect(
      await repository.replace(addFavorite(defaultPreferences(), favorite(1))),
    ).toMatchObject({
      kind: 'partial',
      value: { favorites: [{ city: 'Mumbai' }] },
      unavailable: [SESSION_STORAGE_WARNING],
    });
  });

  it('preserves the last confirmed durable document on quota failure', async () => {
    const storage = new FakeStorage();
    storage.setItem(PREFERENCES_STORAGE_KEY, fixtureBody(validV1StorageFixture));
    const repository = new PreferencesRepository({ storage });
    const confirmed = await repository.load();
    expect(confirmed.kind).toBe('success');
    const original = storage.getItem(PREFERENCES_STORAGE_KEY);
    storage.throwOnSet = true;
    const attempted = selectUnit(
      confirmed.kind === 'success' ? confirmed.value : defaultPreferences(),
      'fahrenheit',
    );
    expect(await repository.replace(attempted)).toMatchObject({
      kind: 'failure',
      error: { category: 'storage', messageKey: 'storage_unavailable' },
    });
    storage.throwOnSet = false;
    expect(storage.getItem(PREFERENCES_STORAGE_KEY)).toBe(original);
    expect(await repository.load()).toMatchObject({
      kind: 'success',
      value: { unit: 'celsius' },
    });
  });

  it('round-trips device identity and provider coordinate precision', async () => {
    const storage = new FakeStorage();
    const repository = new PreferencesRepository({ storage });
    const loaded = deserializePreferences(fixtureBody(validV1StorageFixture)).document;
    expect(await repository.replace(loaded)).toMatchObject({ kind: 'success' });
    const reopened = new PreferencesRepository({ storage });
    const result = await reopened.load();
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.value.favorites[0].identity.latitude.decimal).toBe('19.07283');
    expect(result.value.favorites[1].identity.namespace).toBe('device-coordinates');
  });

  it('applies valid storage events in delivery order and ignores later invalid events', () => {
    const storage = new FakeStorage();
    const source = new EventTarget();
    const repository = new PreferencesRepository({
      storage,
      eventSource: source as Window,
    });
    const listener = vi.fn();
    repository.subscribe(listener);
    const a = serializePreferences(addFavorite(defaultPreferences(), favorite(1, 'A')));
    const b = serializePreferences(
      addFavorite(selectUnit(defaultPreferences(), 'fahrenheit'), favorite(2, 'B')),
    );
    source.dispatchEvent(storageEvent(PREFERENCES_STORAGE_KEY, a));
    source.dispatchEvent(storageEvent(PREFERENCES_STORAGE_KEY, b));
    source.dispatchEvent(storageEvent(PREFERENCES_STORAGE_KEY, corruptStorageFixture));
    source.dispatchEvent(
      storageEvent(PREFERENCES_STORAGE_KEY, fixtureBody(mixedInvalidV1StorageFixture)),
    );
    source.dispatchEvent(storageEvent('another-key', a));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0]).toMatchObject({
      unit: 'fahrenheit',
      favorites: [{ city: 'B' }],
    });
  });
});
