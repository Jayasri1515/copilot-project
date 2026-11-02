import type { Clock, RandomSource, Timer, TimerHandle } from '../../application/ports/Clock';

export class BrowserClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}

export class BrowserTimer implements Timer {
  set(delayMs: number, callback: () => void): TimerHandle {
    return globalThis.setTimeout(callback, delayMs);
  }

  clear(handle: TimerHandle): void {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

export class BrowserRandomSource implements RandomSource {
  next(): number {
    return Math.random();
  }
}
