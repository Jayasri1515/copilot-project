export type ErrorCategory =
  | 'not_found'
  | 'permission_denied'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'http_client'
  | 'http_server'
  | 'validation'
  | 'storage'
  | 'cancelled';

export type SafeErrorKey =
  | 'city_not_found'
  | 'location_permission_denied'
  | 'location_unavailable'
  | 'request_timed_out'
  | 'network_unavailable'
  | 'rate_limited'
  | 'request_rejected'
  | 'service_unavailable'
  | 'invalid_response'
  | 'storage_unavailable'
  | 'operation_cancelled';

export interface OperationError {
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly messageKey: SafeErrorKey;
  readonly retryAfterMs?: number;
}

export function operationError(
  category: ErrorCategory,
  retryable: boolean,
  messageKey: SafeErrorKey,
  retryAfterMs?: number,
): Readonly<OperationError> {
  if (
    retryAfterMs !== undefined &&
    (!Number.isFinite(retryAfterMs) || retryAfterMs < 0)
  ) {
    throw new RangeError('retryAfterMs must be a non-negative finite number');
  }
  return Object.freeze({
    category,
    retryable,
    messageKey,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
}
