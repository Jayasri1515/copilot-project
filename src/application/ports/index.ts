import type {
  DeviceLocationIdentity,
  LocationIdentity,
} from '../../domain/identity';
import type {
  CurrentConditions,
  ForecastDay,
  LocationRef,
  PreferencesDocument,
  RequestBudgetDocument,
  UnitPreference,
} from '../../domain/models';
import type { PortResult } from '../../domain/models/results';
export type { Clock, RandomSource, Timer, TimerHandle } from './Clock';

export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface LocationResolutionPort {
  search(
    city: string,
    options?: RequestOptions,
  ): Promise<PortResult<readonly LocationRef[]>>;
}

export interface WeatherRequest {
  readonly identity: LocationIdentity;
  readonly unit: UnitPreference;
}

export interface WeatherComponents {
  readonly timezone: string | null;
  readonly current: CurrentConditions | null;
  readonly forecast: readonly ForecastDay[] | null;
}

export interface WeatherDataPort {
  getWeather(
    request: Readonly<WeatherRequest>,
    options?: RequestOptions,
  ): Promise<PortResult<Readonly<WeatherComponents>>>;
}

export interface DeviceLocationPort {
  locate(options?: RequestOptions): Promise<PortResult<DeviceLocationIdentity>>;
}

export interface LocalRepositoryPort {
  load(): Promise<PortResult<PreferencesDocument>>;
  replace(
    document: PreferencesDocument,
  ): Promise<PortResult<PreferencesDocument>>;
  subscribe(
    listener: (document: PreferencesDocument) => void,
  ): () => void;
}

export interface RequestBudgetReservation {
  readonly attemptId: string;
  readonly reservedAtEpochMs: number;
}

export interface RequestBudgetCoordinationPort {
  reserve(
    nowEpochMs: number,
    options?: RequestOptions,
  ): Promise<PortResult<RequestBudgetReservation>>;
  read(): Promise<PortResult<RequestBudgetDocument>>;
  subscribe(
    listener: (document: RequestBudgetDocument) => void,
  ): () => void;
}

export interface ClockPort {
  nowEpochMs(): number;
  delay(milliseconds: number, signal?: AbortSignal): Promise<void>;
}
