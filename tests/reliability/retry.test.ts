import { describe, expect, it } from 'bun:test';
import { ProviderError, ResourceError } from '../../src/core/errors.ts';
import {
  abortableSleep,
  parseRetryAfter,
  withRetry,
} from '../../src/reliability/retry.ts';

describe('withRetry', () => {
  it('returns on first success without retrying', async () => {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return 'ok';
    });
    expect(r).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a Transient error then succeeds (no real delay)', async () => {
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls < 3) {
          throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        }
        return calls;
      },
      { baseMs: 0, capMs: 0, jitter: () => 0 },
    );
    expect(r).toBe(3);
    expect(calls).toBe(3);
  });

  it('does NOT retry a RouteWorthy error (ProviderError)', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new ProviderError('down');
        },
        { baseMs: 0, capMs: 0, jitter: () => 0 },
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(1);
  });

  it('gives up after `attempts` and throws the last error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        },
        { attempts: 2, baseMs: 0, capMs: 0, jitter: () => 0 },
      ),
    ).rejects.toThrow('reset');
    expect(calls).toBe(2);
  });

  it('stops early when the signal is already aborted', async () => {
    let calls = 0;
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        },
        {
          attempts: 5,
          baseMs: 0,
          capMs: 0,
          jitter: () => 0,
          signal: ctrl.signal,
        },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1); // first attempt runs, then abort stops re-attempts
  });

  it('honours a custom retryable predicate', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new ResourceError('x');
        },
        { baseMs: 0, capMs: 0, jitter: () => 0, retryable: () => false },
      ),
    ).rejects.toBeInstanceOf(ResourceError);
    expect(calls).toBe(1);
  });
});

describe('abortableSleep', () => {
  it('resolves immediately for ms<=0', async () => {
    await abortableSleep(0);
    expect(true).toBe(true);
  });
  it('resolves early on abort', async () => {
    const ctrl = new AbortController();
    const p = abortableSleep(10_000, ctrl.signal);
    ctrl.abort();
    await p; // should not hang
    expect(true).toBe(true);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds from an APICallError Retry-After header', () => {
    const err = { responseHeaders: { 'retry-after': '2' } };
    expect(parseRetryAfter(err)).toBe(2000);
  });
  it('returns undefined when absent', () => {
    expect(parseRetryAfter(new Error('x'))).toBeUndefined();
  });
});
