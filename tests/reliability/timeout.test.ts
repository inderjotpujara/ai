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
