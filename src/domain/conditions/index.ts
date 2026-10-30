import { isFiniteInRange, VALIDATION_LIMITS } from '../validation/limits';

export const WMO_CONDITIONS = Object.freeze({
  0: Object.freeze({ description: 'Clear sky', iconKey: 'clear' }),
  1: Object.freeze({ description: 'Mainly clear', iconKey: 'mainly-clear' }),
  2: Object.freeze({ description: 'Partly cloudy', iconKey: 'partly-cloudy' }),
  3: Object.freeze({ description: 'Overcast', iconKey: 'overcast' }),
  45: Object.freeze({ description: 'Fog', iconKey: 'fog' }),
  48: Object.freeze({ description: 'Depositing rime fog', iconKey: 'rime-fog' }),
  51: Object.freeze({ description: 'Light drizzle', iconKey: 'drizzle-light' }),
  53: Object.freeze({ description: 'Moderate drizzle', iconKey: 'drizzle-moderate' }),
  55: Object.freeze({ description: 'Dense drizzle', iconKey: 'drizzle-dense' }),
  56: Object.freeze({ description: 'Light freezing drizzle', iconKey: 'freezing-drizzle-light' }),
  57: Object.freeze({ description: 'Dense freezing drizzle', iconKey: 'freezing-drizzle-dense' }),
  61: Object.freeze({ description: 'Slight rain', iconKey: 'rain-slight' }),
  63: Object.freeze({ description: 'Moderate rain', iconKey: 'rain-moderate' }),
  65: Object.freeze({ description: 'Heavy rain', iconKey: 'rain-heavy' }),
  66: Object.freeze({ description: 'Light freezing rain', iconKey: 'freezing-rain-light' }),
  67: Object.freeze({ description: 'Heavy freezing rain', iconKey: 'freezing-rain-heavy' }),
  71: Object.freeze({ description: 'Slight snowfall', iconKey: 'snow-slight' }),
  73: Object.freeze({ description: 'Moderate snowfall', iconKey: 'snow-moderate' }),
  75: Object.freeze({ description: 'Heavy snowfall', iconKey: 'snow-heavy' }),
  77: Object.freeze({ description: 'Snow grains', iconKey: 'snow-grains' }),
  80: Object.freeze({ description: 'Slight rain showers', iconKey: 'rain-showers-slight' }),
  81: Object.freeze({ description: 'Moderate rain showers', iconKey: 'rain-showers-moderate' }),
  82: Object.freeze({ description: 'Violent rain showers', iconKey: 'rain-showers-violent' }),
  85: Object.freeze({ description: 'Slight snow showers', iconKey: 'snow-showers-slight' }),
  86: Object.freeze({ description: 'Heavy snow showers', iconKey: 'snow-showers-heavy' }),
  95: Object.freeze({ description: 'Slight or moderate thunderstorm', iconKey: 'thunderstorm' }),
  96: Object.freeze({ description: 'Thunderstorm with slight hail', iconKey: 'thunderstorm-hail-slight' }),
  99: Object.freeze({ description: 'Thunderstorm with heavy hail', iconKey: 'thunderstorm-hail-heavy' }),
} as const);

export type ConditionIconKey =
  | (typeof WMO_CONDITIONS)[keyof typeof WMO_CONDITIONS]['iconKey']
  | 'unknown';

export interface ConditionSemantic {
  readonly code: number;
  readonly description: string;
  readonly iconKey: ConditionIconKey;
}

const UNKNOWN = Object.freeze({
  description: 'Unknown conditions',
  iconKey: 'unknown' as const,
});

export function conditionForWmoCode(
  input: unknown,
): Readonly<ConditionSemantic> | undefined {
  if (
    !Number.isInteger(input) ||
    !isFiniteInRange(
      input,
      VALIDATION_LIMITS.wmoCode.min,
      VALIDATION_LIMITS.wmoCode.max,
    )
  ) {
    return undefined;
  }
  const mapped = WMO_CONDITIONS[input as keyof typeof WMO_CONDITIONS] ?? UNKNOWN;
  return Object.freeze({ code: input, ...mapped });
}
