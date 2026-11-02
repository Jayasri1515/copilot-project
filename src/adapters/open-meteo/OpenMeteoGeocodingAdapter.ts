import type {
  LocationResolutionPort,
  RequestOptions,
} from '../../application/ports';
import { operationError } from '../../domain/errors';
import type { LocationRef } from '../../domain/models';
import type { PortResult } from '../../domain/models/results';
import {
  validateGeocodingContract,
} from '../../domain/validation/contracts';
import { isAcceptedString } from '../../domain/validation/limits';
import {
  OpenMeteoClient,
  type OpenMeteoDependencies,
} from './OpenMeteoClient';

export const GEOCODING_ENDPOINT =
  'https://geocoding-api.open-meteo.com/v1/search';
export const GEOCODING_RESULT_COUNT = 20;
export const GEOCODING_LANGUAGE = 'en';

export class OpenMeteoGeocodingAdapter implements LocationResolutionPort {
  readonly #client: OpenMeteoClient;

  constructor(dependencies: OpenMeteoDependencies) {
    this.#client = new OpenMeteoClient(dependencies);
  }

  search(
    city: string,
    options?: RequestOptions,
  ): Promise<PortResult<readonly LocationRef[]>> {
    const name = typeof city === 'string' ? city.trim() : '';
    if (name === '' || !isAcceptedString(name)) {
      return Promise.resolve({
        kind: 'failure',
        error: operationError('validation', false, 'request_rejected'),
      });
    }

    const url = new URL(GEOCODING_ENDPOINT);
    url.searchParams.set('name', name);
    url.searchParams.set('count', String(GEOCODING_RESULT_COUNT));
    url.searchParams.set('language', GEOCODING_LANGUAGE);
    url.searchParams.set('format', 'json');

    return this.#client.get(url, (payload, metadata) => {
      const contract = validateGeocodingContract(payload);
      if (!contract.valid) {
        return {
          kind: 'failure',
          error: operationError('validation', false, 'invalid_response'),
        };
      }
      if (contract.value.candidates.length === 0) {
        return {
          kind: 'failure',
          error: operationError('not_found', false, 'city_not_found'),
        };
      }
      if (contract.value.rejectedCandidates > 0) {
        return {
          kind: 'partial',
          value: contract.value.candidates,
          unavailable: Object.freeze(['invalid_candidates']),
          metadata,
        };
      }
      return {
        kind: 'success',
        value: contract.value.candidates,
        metadata,
      };
    }, options);
  }
}
