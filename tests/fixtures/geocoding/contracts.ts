import { immutableFixture } from '../immutable';

export const validGeocodingFixture = immutableFixture({
  results: [
    {
      id: 1275339,
      name: 'Mumbai',
      latitude: 19.07283,
      longitude: 72.88261,
      elevation: 8,
      timezone: 'Asia/Kolkata',
      country: 'India',
      admin1: 'Maharashtra',
    },
    {
      id: 1,
      name: 'No Region',
      latitude: -90,
      longitude: 180,
      timezone: 'UTC',
    },
  ],
  generationtime_ms: 0.12,
});

export const geocodingContractFixtures = immutableFixture({
  empty: {},
  malformedJson: '{"results": [}',
  wrongResultsType: { results: 'not-an-array' },
  missingName: {
    results: [{ id: 1, latitude: 1, longitude: 2 }],
  },
  wrongIdType: {
    results: [{ id: '1', name: 'Wrong', latitude: 1, longitude: 2 }],
  },
  extraField: {
    results: [
      {
        id: 1,
        name: 'Extra',
        latitude: 1,
        longitude: 2,
        future_provider_field: { ignored: true },
      },
    ],
    future_envelope_field: true,
  },
});
