import { immutableFixture } from '../immutable';

export const documentedWmoCodesFixture = immutableFixture([
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75,
  77, 80, 81, 82, 85, 86, 95, 96, 99,
]);

export const unknownValidWmoCodeFixture = 4;

export const validWeatherFixture = immutableFixture({
  latitude: 19.07283,
  longitude: 72.88261,
  elevation: 8,
  timezone: 'Asia/Kolkata',
  current_units: {
    temperature_2m: '°C',
    relative_humidity_2m: '%',
    weather_code: 'wmo code',
  },
  current: {
    temperature_2m: 30.5,
    relative_humidity_2m: 70,
    weather_code: 2,
  },
  daily_units: {
    weather_code: 'wmo code',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
  },
  daily: {
    time: ['2026-10-27', '2026-10-28'],
    weather_code: [2, 4],
    temperature_2m_max: [32, 31],
    temperature_2m_min: [25, 24],
  },
  future_provider_field: 'ignored',
});

export const weatherContractFixtures = immutableFixture({
  malformedJson: '{"latitude":',
  missingRequired: {
    ...validWeatherFixture,
    timezone: undefined,
  },
  wrongType: {
    ...validWeatherFixture,
    current: {
      ...validWeatherFixture.current,
      relative_humidity_2m: '70',
    },
  },
  extraField: validWeatherFixture,
});
