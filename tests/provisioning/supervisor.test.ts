import { describe, expect, it } from 'bun:test';
import { checkDiskSpace, withRetry } from '../../src/provisioning/supervisor.ts';

describe('checkDiskSpace', () => {
  it('fails when required + headroom exceeds free', () => {
    const r = checkDiskSpace({ requiredBytes: 900, freeBytes: 1000, headroomBytes: 200 });
    expect(r.ok).toBe(false);
    expect(r.shortfallBytes).toBe(100); // 900+200 - 1000
  });
  it('passes with sufficient free space', () => {
    expect(checkDiskSpace({ requiredBytes: 500, freeBytes: 1000, headroomBytes: 200 }).ok).toBe(true);
  });
});

describe('withRetry', () => {
  it('retries a failing fn then succeeds, calling onRetry each time', async () => {
    let calls = 0;
    const retries: number[] = [];
    const out = await withRetry(
      async () => { calls++; if (calls < 3) throw new Error('boom'); return 'ok'; },
      { attempts: 5, baseMs: 0, capMs: 0, jitter: () => 0, onRetry: (n) => retries.push(n) },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });
  it('rethrows after exhausting attempts', async () => {
    await expect(
      withRetry(async () => { throw new Error('always'); }, { attempts: 2, baseMs: 0, capMs: 0, jitter: () => 0 }),
    ).rejects.toThrow('always');
  });
});
