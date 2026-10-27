import type {
  RequestOptions,
  WeatherComponents,
  WeatherDataPort,
  WeatherRequest,
} from '../../application/ports';
import { operationError } from '../../domain/errors';
import {
  createDeviceIdentity,
  createSearchIdentity,
} from '../../domain/identity';
import type { PortResult } from '../../domain/models/results';
import { validateWeatherContract } from '../../domain/validation/contracts';
import {
  OpenMeteoClient,
  type OpenMeteoDependencies,
} from './OpenMeteoClient';

export const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const CURRENT_VARIABLES =
  'temperature_2m,relative_humidity_2m,weather_code';
export const DAILY_VARIABLES =
  'weather_code,temperature_2m_max,temperature_2m_min';

function unavailableFields(value: WeatherComponents): readonly string[] {
  const unavailable: string[] = [];
  if (value.timezone === null) unavailable.push('timezone');
  if (value.current === null) {
    unavailable.push('current');
  } else {
    if (value.current.temperature === null) unavailable.push('current.temperature');
    if (value.current.humidityPercent === null) unavailable.push('current.humidity');
    if (value.current.condition === null) unavailable.push('current.condition');
  }
  for (const [index, day] of (value.forecast ?? []).entries()) {
    if (day.temperatureMax === null) unavailable.push(`forecast.${index}.temperatureMax`);
    if (day.temperatureMin === null) unavailable.push(`forecast.${index}.temperatureMin`);
    if (day.condition === null) unavailable.push(`forecast.${index}.condition`);
  }
  return Object.freeze(unavailable);
}

export class OpenMeteoWeatherAdapter implements WeatherDataPort {
  readonly #client: OpenMeteoClient;

  constructor(dependencies: OpenMeteoDependencies) {
    this.#client = new OpenMeteoClient(dependencies);
  }

  getWeather(
    request: Readonly<WeatherRequest>,
    options?: RequestOptions,
  ): Promise<PortResult<Readonly<WeatherComponents>>> {
    if (request.unit !== 'celsius' && request.unit !== 'fahrenheit') {
      return Promise.resolve({
        kind: 'failure',
        error: operationError('validation', false, 'request_rejected'),
      });
    }
    const identity = request.identity;
    const validatedIdentity =
      identity?.namespace === 'open-meteo-search'
        ? createSearchIdentity({
            providerId: identity.providerId,
            latitude: { decimal: identity.latitude?.decimal },
            longitude: { decimal: identity.longitude?.decimal },
          })
        : identity?.namespace === 'device-coordinates'
          ? createDeviceIdentity({
              latitude: { decimal: identity.latitude?.decimal },
              longitude: { decimal: identity.longitude?.decimal },
            })
          : undefined;
    if (!validatedIdentity) {
      return Promise.resolve({
        kind: 'failure',
        error: operationError('validation', false, 'request_rejected'),
      });
    }

    const url = new URL(FORECAST_ENDPOINT);
    url.searchParams.set('latitude', validatedIdentity.latitude.decimal);
    url.searchParams.set('longitude', validatedIdentity.longitude.decimal);
    url.searchParams.set('current', CURRENT_VARIABLES);
    url.searchParams.set('daily', DAILY_VARIABLES);
    url.searchParams.set('temperature_unit', request.unit);
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '4');

    return this.#client.get(url, (payload, metadata) => {
      const contract = validateWeatherContract(payload, request.unit);
      if (!contract.valid) {
        return {
          kind: 'failure',
          error: operationError('validation', false, 'invalid_response'),
        };
      }
      const value: Readonly<WeatherComponents> = Object.freeze({
        timezone: contract.value.timezone,
        current: contract.value.current,
        forecast: contract.value.daily,
      });
      const unavailable = unavailableFields(value);
      return unavailable.length > 0
        ? { kind: 'partial', value, unavailable, metadata }
        : { kind: 'success', value, metadata };
    }, options);
  }
}
