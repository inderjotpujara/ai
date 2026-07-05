### Task 4: withRetry + parseRetryAfter + abortableSleep

**Files:**
- Create: `src/reliability/retry.ts`
- Test: `tests/reliability/retry.test.ts`

**Interfaces:**
- Consumes: `classify`, `Lane` (retries only Transient); `retryBaseMs`, `retryCapMs`, `maxAttempts` from config.
- Produces:
  - `type RetryOpts = { attempts?: number; baseMs?: number; capMs?: number; jitter?: () => number; onRetry?: (n: number) => void; signal?: AbortSignal; retryable?: (err: unknown) => boolean; }`
  - `withRetry<T>(fn: () => Promise<T>, opts?: RetryOpts): Promise<T>`
  - `abortableSleep(ms: number, signal?: AbortSignal): Promise<void>`
  - `parseRetryAfter(err: unknown): number | undefined` (ms, from a `Retry-After` header on an `APICallError`'s `responseHeaders`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/retry.test.ts
import { describe, expect, it } from 'bun:test';
import { ProviderError, ResourceError } from '../../src/core/errors.ts';
import { abortableSleep, parseRetryAfter, withRetry } from '../../src/reliability/retry.ts';

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
      withRetry(async () => {
        calls++;
        throw new ProviderError('down');
      }, { baseMs: 0, capMs: 0, jitter: () => 0 }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(1);
  });

  it('gives up after `attempts` and throws the last error', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      }, { attempts: 2, baseMs: 0, capMs: 0, jitter: () => 0 }),
    ).rejects.toThrow('reset');
    expect(calls).toBe(2);
  });

  it('stops early when the signal is already aborted', async () => {
    let calls = 0;
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      withRetry(async () => {
        calls++;
        throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      }, { attempts: 5, baseMs: 0, capMs: 0, jitter: () => 0, signal: ctrl.signal }),
    ).rejects.toThrow();
    expect(calls).toBe(1); // first attempt runs, then abort stops re-attempts
  });

  it('honours a custom retryable predicate', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new ResourceError('x');
      }, { baseMs: 0, capMs: 0, jitter: () => 0, retryable: () => false }),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/retry.test.ts`
Expected: FAIL — cannot resolve `retry.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/retry.ts
import { maxAttempts, retryBaseMs, retryCapMs } from './config.ts';
import { classify, Lane } from './classify.ts';

/** Sleep for `ms`, resolving early if `signal` is (or becomes) aborted. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (!signal) return new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Extract a Retry-After delay (ms) from an error's response headers, if present. */
export function parseRetryAfter(err: unknown): number | undefined {
  const headers = (err as { responseHeaders?: Record<string, string> })?.responseHeaders;
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (!raw) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

export type RetryOpts = {
  attempts?: number;
  baseMs?: number;
  capMs?: number;
  jitter?: () => number;
  onRetry?: (n: number) => void;
  signal?: AbortSignal;
  /** Override the default (classify → Transient) retryability test. */
  retryable?: (err: unknown) => boolean;
};

/**
 * Full-jitter exponential backoff retry for cross-boundary ops WE own
 * (MCP calls, downloads, probes, direct HTTP). By default retries only the
 * Transient lane. NEVER wrap an LLM generateText turn in this (see spec D5).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const attempts = opts.attempts ?? maxAttempts();
  const baseMs = opts.baseMs ?? retryBaseMs();
  const capMs = opts.capMs ?? retryCapMs();
  const jitter = opts.jitter ?? (() => 0.5 + Math.random() / 2);
  const retryable = opts.retryable ?? ((e: unknown) => classify(e) === Lane.Transient);

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && opts.signal?.aborted) break;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!retryable(err)) throw err;
      const next = attempt + 1;
      if (next >= attempts) break;
      if (opts.signal?.aborted) break;
      opts.onRetry?.(next);
      const backoff = Math.min(capMs, baseMs * 2 ** attempt);
      const retryAfter = parseRetryAfter(err);
      const delay = retryAfter ?? Math.floor(jitter() * backoff);
      await abortableSleep(delay, opts.signal);
    }
  }
  throw lastErr;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/retry.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/retry.ts" "tests/reliability/retry.test.ts"
git add src/reliability/retry.ts tests/reliability/retry.test.ts
git commit -m "feat(reliability): withRetry (Transient-only, Retry-After aware) + abortableSleep"
```

---

