import { immutableFixture } from '../immutable';
import { validWeatherFixture } from './contracts';

export const partialWeatherResponse = immutableFixture({
  ...validWeatherFixture,
  current: {
    temperature_2m: null,
    relative_humidity_2m: 70,
    weather_code: null,
  },
  daily: {
    ...validWeatherFixture.daily,
    temperature_2m_min: [null, 24],
  },
});

export const fahrenheitWeatherResponse = immutableFixture({
  ...validWeatherFixture,
  current_units: {
    ...validWeatherFixture.current_units,
    temperature_2m: '°F',
  },
  current: {
    ...validWeatherFixture.current,
    temperature_2m: 86.9,
  },
  daily_units: {
    ...validWeatherFixture.daily_units,
    temperature_2m_max: '°F',
    temperature_2m_min: '°F',
  },
  daily: {
    ...validWeatherFixture.daily,
    temperature_2m_max: [89.6, 87.8],
    temperature_2m_min: [77, 75.2],
  },
});
