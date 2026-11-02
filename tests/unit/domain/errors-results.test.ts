import { describe, expect, it } from 'vitest';
import { operationError } from '../../../src/domain/errors';
import type { PortResult } from '../../../src/domain/models/results';

describe('safe discriminated results', () => {
  it('constructs a safe closed error without provider text', () => {
    expect(
      operationError('rate_limited', true, 'rate_limited', 1000),
    ).toEqual({
      category: 'rate_limited',
      retryable: true,
      messageKey: 'rate_limited',
      retryAfterMs: 1000,
    });
  });

  it('rejects invalid retry metadata', () => {
    expect(() =>
      operationError('network', true, 'network_unavailable', -1),
    ).toThrow(RangeError);
  });

  it('narrows success, partial, and failure results', () => {
    const results: readonly PortResult<number>[] = [
      { kind: 'success', value: 1, metadata: {} },
      { kind: 'partial', value: 2, unavailable: ['humidity'], metadata: {} },
      {
        kind: 'failure',
        error: operationError('validation', false, 'invalid_response'),
      },
    ];
    expect(results.map((result) => result.kind)).toEqual([
      'success',
      'partial',
      'failure',
    ]);
  });
});
