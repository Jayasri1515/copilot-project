import { immutableFixture } from '../immutable';

export const validV1StorageFixture = immutableFixture({
  version: 1,
  unit: 'celsius',
  favorites: [
    {
      namespace: 'open-meteo-search',
      providerId: 1275339,
      latitude: '19.07283',
      longitude: '72.88261',
      city: 'Mumbai',
      administrativeRegion: 'Maharashtra',
      country: 'India',
    },
    {
      namespace: 'device-coordinates',
      latitude: '12.9715987',
      longitude: '77.594566',
      city: 'Current location',
      administrativeRegion: null,
      country: null,
    },
  ],
});

export const mixedInvalidV1StorageFixture = immutableFixture({
  version: 1,
  unit: 'fahrenheit',
  favorites: [
    validV1StorageFixture.favorites[0],
    {
      namespace: 'open-meteo-search',
      providerId: '1275339',
      latitude: '19.07283',
      longitude: '72.88261',
      city: 'Invalid ID',
      administrativeRegion: null,
      country: null,
    },
  ],
});

export const corruptStorageFixture = '{"version":1,"favorites":[';

export const futureVersionStorageFixture = immutableFixture({
  version: 2,
  unit: 'celsius',
  favorites: [],
});
