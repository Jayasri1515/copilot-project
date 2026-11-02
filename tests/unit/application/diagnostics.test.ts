import { describe, expect, it } from 'vitest';
import { InMemoryDiagnostics } from '../../../src/application/diagnostics';
import type { Clock } from '../../../src/application/ports/Clock';

class FixedClock implements Clock {
  now = 42;
  nowEpochMs(): number {
    return this.now;
  }
}

describe('InMemoryDiagnostics', () => {
  it('bounds entries, uses coarse latency, and clears all session state', () => {
    const clock = new FixedClock();
    const diagnostics = new InMemoryDiagnostics(clock, 2);
    diagnostics.record({ outcome: 'success', latencyMs: 249 });
    clock.now++;
    diagnostics.record({
      outcome: 'failure',
      category: 'network',
      latencyMs: 250,
      retried: true,
    });
    clock.now++;
    diagnostics.record({
      outcome: 'failure',
      category: 'timeout',
      latencyMs: 10_000,
      timedOut: true,
    });

    expect(diagnostics.entries()).toEqual([
      expect.objectContaining({
        sequence: 2,
        latency: 'under_1s',
        retried: true,
      }),
      expect.objectContaining({
        sequence: 3,
        latency: '10s_plus',
        timedOut: true,
      }),
    ]);
    diagnostics.clear();
    expect(diagnostics.entries()).toEqual([]);
  });

  it('copies only allowlisted safe fields and has no persistence/export/transmission API', () => {
    const diagnostics = new InMemoryDiagnostics(new FixedClock());
    diagnostics.record({
      outcome: 'failure',
      category: 'validation',
      latencyMs: 1,
      // Simulate an untrusted caller with prohibited extra data.
      rawPayload: '{"secret":"value"}',
      searchHistory: ['private city'],
      latitude: 12.345678,
      favorite: 'home',
      permissionState: 'granted',
    } as never);

    const serializedForAssertionOnly = JSON.stringify(diagnostics.entries());
    expect(serializedForAssertionOnly).not.toContain('secret');
    expect(serializedForAssertionOnly).not.toContain('private city');
    expect(serializedForAssertionOnly).not.toContain('12.345678');
    expect(serializedForAssertionOnly).not.toContain('home');
    expect(serializedForAssertionOnly).not.toContain('granted');
    expect('export' in diagnostics).toBe(false);
    expect('persist' in diagnostics).toBe(false);
    expect('send' in diagnostics).toBe(false);

    const reloadedSession = new InMemoryDiagnostics(new FixedClock());
    expect(reloadedSession.entries()).toEqual([]);
  });

  it('rejects unsafe capacities and invalid latency', () => {
    const clock = new FixedClock();
    expect(() => new InMemoryDiagnostics(clock, 0)).toThrow(RangeError);
    const diagnostics = new InMemoryDiagnostics(clock);
    expect(() =>
      diagnostics.record({ outcome: 'success', latencyMs: -1 }),
    ).toThrow(RangeError);
  });
});
