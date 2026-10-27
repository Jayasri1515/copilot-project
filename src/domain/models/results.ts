import type { OperationError } from '../errors';

export interface SafeResultMetadata {
  readonly retrievedAtEpochMs?: number;
  readonly status?: number;
}

export type PortResult<T> =
  | {
      readonly kind: 'success';
      readonly value: T;
      readonly metadata: Readonly<SafeResultMetadata>;
    }
  | {
      readonly kind: 'partial';
      readonly value: T;
      readonly unavailable: readonly string[];
      readonly metadata: Readonly<SafeResultMetadata>;
    }
  | {
      readonly kind: 'failure';
      readonly error: Readonly<OperationError>;
    };
