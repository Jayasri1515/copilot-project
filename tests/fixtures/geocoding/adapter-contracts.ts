import { immutableFixture } from '../immutable';

export const ambiguousGeocodingResponse = immutableFixture({
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
      id: 2643743,
      name: 'London',
      latitude: 51.50853,
      longitude: -0.12574,
      elevation: 25,
      timezone: 'Europe/London',
      country: 'United Kingdom',
      admin1: 'England',
    },
  ],
});

export const partialGeocodingResponse = immutableFixture({
  results: [
    ambiguousGeocodingResponse.results[0],
    {
      id: -1,
      name: 'Invalid ID',
      latitude: 91,
      longitude: 0,
    },
  ],
});
