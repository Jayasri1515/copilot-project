import type { OperationError } from '../../domain/errors';
import type {
  LocationRef,
  PreferencesDocument,
  UnitPreference,
  WeatherSnapshot,
} from '../../domain/models';

export type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly token: number }
  | {
      readonly status: 'candidates';
      readonly token: number;
      readonly candidates: readonly LocationRef[];
    }
  | { readonly status: 'error'; readonly token: number; readonly error: OperationError };

export type DeviceLocationState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly token: number }
  | { readonly status: 'error'; readonly token: number; readonly error: OperationError };

export interface WeatherOperationState {
  readonly status: 'loading';
  readonly token: number;
  readonly reason: 'selection' | 'unit' | 'refresh' | 'retry';
  readonly location: LocationRef;
  readonly unit: UnitPreference;
}

export interface ApplicationState {
  readonly preferences: PreferencesDocument;
  readonly preferenceWarnings: readonly string[];
  readonly preferenceError?: OperationError;
  readonly search: SearchState;
  readonly deviceLocation: DeviceLocationState;
  readonly weather?: WeatherSnapshot;
  readonly operation?: WeatherOperationState;
  readonly retryBlockedUntilEpochMs?: number;
}

export type ApplicationEvent =
  | { readonly type: 'state_changed'; readonly state: ApplicationState }
  | { readonly type: 'request_superseded'; readonly token: number }
  | { readonly type: 'stale_result_rejected'; readonly token: number }
  | { readonly type: 'duplicate_refresh_ignored'; readonly token: number }
  | {
      readonly type: 'retry_blocked';
      readonly retryAllowedAtEpochMs: number;
    };
