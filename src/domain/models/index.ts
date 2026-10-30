import type { ConditionSemantic } from '../conditions';
import type { OperationError } from '../errors';
import type { LocationIdentity } from '../identity';

export type UnitPreference = 'celsius' | 'fahrenheit';
export type Availability<T> = T | null;

export interface LocationRef {
  readonly identity: LocationIdentity;
  readonly city: string;
  readonly administrativeRegion: Availability<string>;
  readonly country: Availability<string>;
  readonly timezone: Availability<string>;
  readonly elevationMetres: Availability<number>;
}

export interface CurrentConditions {
  readonly temperature: Availability<number>;
  readonly humidityPercent: Availability<number>;
  readonly condition: Availability<ConditionSemantic>;
}

export interface ForecastDay {
  readonly date: string;
  readonly temperatureMax: Availability<number>;
  readonly temperatureMin: Availability<number>;
  readonly condition: Availability<ConditionSemantic>;
}

export type ComponentState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly value: T }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error'; readonly error: OperationError }
  | { readonly status: 'timeout'; readonly error: OperationError }
  | { readonly status: 'cancelled'; readonly error: OperationError };

export interface WeatherSnapshot {
  readonly requestToken: number;
  readonly identity: LocationIdentity;
  readonly unit: UnitPreference;
  readonly current: ComponentState<CurrentConditions>;
  readonly forecast: ComponentState<readonly ForecastDay[]>;
  readonly retrievedAt?: string;
  readonly stale: boolean;
  /**
   * Values retained from the last successful snapshot after a same-identity,
   * same-unit refresh failed. They are never interpreted as belonging to a
   * different request identity.
   */
  readonly retained?: Readonly<{
    readonly current?: CurrentConditions;
    readonly forecast?: readonly ForecastDay[];
  }>;
}

export interface Favorite {
  readonly identity: LocationIdentity;
  readonly city: string;
  readonly administrativeRegion: Availability<string>;
  readonly country: Availability<string>;
}

export interface PreferencesDocument {
  readonly version: 1;
  readonly unit: UnitPreference;
  readonly favorites: readonly Favorite[];
}

export interface RequestBudgetDocument {
  readonly version: 1;
  readonly attempts: readonly {
    readonly id: string;
    readonly occurredAtEpochMs: number;
  }[];
  readonly revision: number;
}
