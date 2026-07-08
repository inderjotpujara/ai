import { describe, expect, it } from 'bun:test';
import {
  IdleWatchdog,
  withIdleTimeout,
  withWallClock,
} from '../../src/reliability/timeout.ts';

describe('withWallClock', () => {
  it('resolves the fn result when it finishes in time', async () => {
    const r = await withWallClock(1000, async () => 42);
    expect(r).toBe(42);
  });
  it('rejects with a timeout when the fn is too slow', async () => {
    await expect(
      withWallClock(
        10,
        () => new Promise((r) => setTimeout(() => r('late'), 1000)),
      ),
    ).rejects.toThrow('timeout');
  });
  it('aborts the work signal on timeout', async () => {
    let seen: AbortSignal | undefined;
    await expect(
      withWallClock(
        10,
        (signal) =>
          new Promise((_, rej) => {
            seen = signal;
            signal.addEventListener('abort', () =>
              rej(new Error('aborted-by-clock')),
            );
          }),
      ),
    ).rejects.toThrow('timeout');
    expect(seen?.aborted).toBe(true);
  });
  it('aborts the work AND rejects with timeout when a (not-yet-aborted) external signal is supplied but the clock fires first', async () => {
    const ext = new AbortController(); // supplied, but never aborted by us
    let seen: AbortSignal | undefined;
    await expect(
      withWallClock(
        10,
        (signal) =>
          new Promise((_, rej) => {
            seen = signal;
            signal.addEventListener('abort', () =>
              rej(new Error('aborted-by-clock')),
            );
          }),
        ext.signal,
      ),
    ).rejects.toThrow('timeout');
    expect(seen?.aborted).toBe(true);
  });
  it('aborts when an external signal aborts', async () => {
    const ext = new AbortController();
    const p = withWallClock(
      10_000,
      (s) =>
        new Promise((_, rej) => {
          s.addEventListener('abort', () => rej(new Error('x')));
        }),
      ext.signal,
    );
    ext.abort();
    await expect(p).rejects.toThrow('x');
  });
});

describe('IdleWatchdog', () => {
  it('fires onIdle only after the timeout with no progress', () => {
    let fired = 0;
    let clock = 0;
    const w = new IdleWatchdog(
      100,
      () => fired++,
      () => clock,
    );
    w.beat(0); // start tracking at time 0 (no advance yet)
    clock = 50;
    w.tick();
    expect(fired).toBe(0);
    clock = 150;
    w.tick();
    expect(fired).toBe(1);
  });
  it('resets the idle timer on progress', () => {
    let fired = 0;
    let clock = 0;
    const w = new IdleWatchdog(
      100,
      () => fired++,
      () => clock,
    );
    w.beat(0);
    clock = 90;
    w.beat(10); // progress → resets
    clock = 150;
    w.tick(); // only 60ms since last progress
    expect(fired).toBe(0);
  });
  it('fires onIdle when progress goes silent after advancing (the classic hang)', () => {
    let fired = 0;
    let clock = 0;
    const w = new IdleWatchdog(
      100,
      () => fired++,
      () => clock,
    );
    w.beat(5); // real progress at t=0
    clock = 50;
    w.tick(); // 50ms since last advance → no fire
    expect(fired).toBe(0);
    clock = 200;
    w.tick(); // 200ms since last advance, no further beats → MUST fire
    expect(fired).toBe(1);
  });
});

describe('withIdleTimeout', () => {
  it('passes a beat fn and returns the result', async () => {
    const r = await withIdleTimeout(
      async (beat) => {
        beat(1);
        beat(2);
        return 'done';
      },
      { idleMs: 10_000, onIdle: () => {}, intervalMs: 1000 },
    );
    expect(r).toBe('done');
  });
});
