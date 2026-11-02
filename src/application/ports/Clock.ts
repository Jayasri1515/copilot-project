export interface Clock {
  nowEpochMs(): number;
}

export type TimerHandle = unknown;

export interface Timer {
  set(delayMs: number, callback: () => void): TimerHandle;
  clear(handle: TimerHandle): void;
}

export interface RandomSource {
  /** Returns a value in the half-open interval [0, 1). */
  next(): number;
}
