import { describe, expect, it } from 'vitest';
import {
  addFavorite,
  clearFavorites,
  defaultPreferences,
  removeFavorite,
  selectUnit,
} from '../../../src/application/favorites';
import {
  createDeviceIdentity,
  createSearchIdentity,
} from '../../../src/domain/identity';
import type { Favorite } from '../../../src/domain/models';

function searchFavorite(id: number, city = 'Mumbai'): Favorite {
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

describe('favorite document operations', () => {
  it('deduplicates canonical identities and migrates a changed search ID', () => {
    const first = addFavorite(defaultPreferences(), searchFavorite(1275339));
    expect(addFavorite(first, searchFavorite(1275339))).toBe(first);

    const migrated = addFavorite(first, searchFavorite(999999, 'New Mumbai'));
    expect(migrated.favorites).toHaveLength(1);
    expect(
      migrated.favorites[0].identity.namespace === 'open-meteo-search' &&
        migrated.favorites[0].identity.providerId,
    ).toBe(999999);
    expect(migrated.favorites[0].city).toBe('New Mumbai');
  });

  it('keeps device and search namespaces distinct', () => {
    const deviceIdentity = createDeviceIdentity({
      latitude: { decimal: '19.07283' },
      longitude: { decimal: '72.88261' },
    });
    if (!deviceIdentity) throw new Error('invalid test identity');
    const device: Favorite = {
      identity: deviceIdentity,
      city: 'Current location',
      administrativeRegion: null,
      country: null,
    };
    const document = addFavorite(
      addFavorite(defaultPreferences(), searchFavorite(1)),
      device,
    );
    expect(document.favorites).toHaveLength(2);
  });

  it('removes only the selected favorite and clears while preserving unit', () => {
    const one = searchFavorite(1);
    const twoIdentity = createSearchIdentity({
      providerId: 2,
      latitude: { decimal: '20' },
      longitude: { decimal: '73' },
    });
    if (!twoIdentity) throw new Error('invalid test identity');
    const two: Favorite = { ...one, identity: twoIdentity, city: 'Pune' };
    const initial = selectUnit(
      addFavorite(addFavorite(defaultPreferences(), one), two),
      'fahrenheit',
    );
    const removed = removeFavorite(initial, one.identity);
    expect(removed.favorites.map(({ city }) => city)).toEqual(['Pune']);
    expect(clearFavorites(removed)).toMatchObject({
      unit: 'fahrenheit',
      favorites: [],
    });
  });
});
