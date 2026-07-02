import { describe, expect, it } from 'bun:test';
import {
  checkDiskSpace,
  StallWatchdog,
  withRetry,
} from '../../src/provisioning/supervisor.ts';

describe('checkDiskSpace', () => {
  it('fails when required + headroom exceeds free', () => {
    const r = checkDiskSpace({
      requiredBytes: 900,
      freeBytes: 1000,
      headroomBytes: 200,
    });
    expect(r.ok).toBe(false);
    expect(r.shortfallBytes).toBe(100); // 900+200 - 1000
  });
  it('passes with sufficient free space', () => {
    expect(
      checkDiskSpace({
        requiredBytes: 500,
        freeBytes: 1000,
        headroomBytes: 200,
      }).ok,
    ).toBe(true);
  });
});

describe('withRetry', () => {
  it('retries a failing fn then succeeds, calling onRetry each time', async () => {
    let calls = 0;
    const retries: number[] = [];
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('boom');
        return 'ok';
      },
      {
        attempts: 5,
        baseMs: 0,
        capMs: 0,
        jitter: () => 0,
        onRetry: (n) => retries.push(n),
      },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });
  it('rethrows after exhausting attempts', async () => {
    await expect(
      withRetry(
        async () => {
          throw new Error('always');
        },
        { attempts: 2, baseMs: 0, capMs: 0, jitter: () => 0 },
      ),
    ).rejects.toThrow('always');
  });
  it('resolves the backoff delay promptly when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let calls = 0;
    const start = Date.now();
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('boom');
        },
        {
          attempts: 3,
          baseMs: 5_000,
          capMs: 5_000,
          jitter: () => 1,
          signal: ctrl.signal,
        },
      ),
    ).rejects.toThrow();
    const elapsed = Date.now() - start;
    expect(calls).toBe(1); // stopped after first attempt instead of sleeping out a 5s backoff
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('StallWatchdog', () => {
  it('fires onStall when no byte progress is made past timeoutMs', () => {
    let now = 0;
    let stalls = 0;
    const wd = new StallWatchdog(
      1000,
      () => {
        stalls++;
      },
      () => now,
    );
    wd.beat(100); // first beat: advances from initial -1, sets a baseline
    now = 500;
    wd.beat(100); // no advance from 100 → starts the stall clock at now=500
    now = 1600; // 1100ms since stall started — past the 1000ms timeout
    wd.tick();
    expect(stalls).toBe(1);
  });
  it('does not fire when a beat with larger bytes resets the stall before timeout', () => {
    let now = 0;
    let stalls = 0;
    const wd = new StallWatchdog(
      1000,
      () => {
        stalls++;
      },
      () => now,
    );
    wd.beat(0);
    now = 500;
    wd.beat(100); // progress resets stalledSince
    now = 1400; // 900ms since reset — under the 1000ms timeout
    wd.tick();
    expect(stalls).toBe(0);
  });
  it('stop() is safe to call even if start() was never called', () => {
    const wd = new StallWatchdog(
      1000,
      () => {},
      () => 0,
    );
    expect(() => wd.stop()).not.toThrow();
  });
});
