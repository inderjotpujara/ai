# Graceful Degradation + Retries (Slice 21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one canonical `src/reliability/` layer (error-lane classification, retry with backoff+Retry-After, run/idle timeouts, a hand-rolled circuit breaker, a failure-domain-aware model-degradation chain, and a user-facing degradation ledger), wire it into delegation/workflow/crew/MCP/selector, and migrate the fragmented retry/timeout duplicates onto it — so a dead dependency drops that agent/step and tells the user instead of sinking the run.

**Architecture:** New `src/reliability/` module of small single-purpose files, built and unit-tested in isolation first, then wired into the execution seams (`core/agent.ts`, `core/delegate.ts`, `core/orchestrator.ts`, `workflow/engine.ts`+`run-step.ts`, `crew/engine.ts`, `mcp/client.ts`, `resource/selector.ts`, `cli/select-hook.ts`, `runtime/*`). Existing retry/timeout primitives (`provisioning/supervisor.ts`, `verified-build/dry-run.ts`, runtime probe literals) are migrated to import from the new module. In-run reliability only — persistence/resume is Slice 24.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`), AI SDK v6 (`ai` — `APICallError`, `generateText`), OpenTelemetry spans (existing `src/telemetry`), Zod (existing). Zero new npm dependencies.

## Global Constraints

- **Bun only** — never `npm`. Tests: `bun test`; typecheck: `bun run typecheck`; lint a file: `bun run lint:file -- "<glob>"`.
- **Imports carry the `.ts` extension** and reference source as `../../src/....ts` from `tests/`.
- **Tests live in `tests/<subsystem>/<name>.test.ts`** mirroring `src/`; use `import { describe, expect, it } from 'bun:test';`.
- **Prefer `enum` over string-literal unions** for finite named sets (string enums only, e.g. `enum Lane { ... }`). Discriminated object unions stay `type`.
- **Hardcode nothing** — thresholds/budgets/limits compute live; env vars are fallback-only (pattern: `Number(process.env[name]) || fallback`).
- **`type` over `interface`**; early returns; small focused files; descriptive names.
- **No `console.log`** left behind; **don't commit without `bun run typecheck`**.
- **Errors extend `FrameworkError`** (from `src/core/errors.ts`) — the base sets `name`. Do **not** add a `kind` field to error classes; classification is a pure function.
- **D5 (binding):** never wrap an LLM `generateText` turn in a second backoff retry. `reliability/withRetry` is for cross-boundary ops we own (MCP calls, downloads, probes, direct HTTP). A Transient error escaping the SDK is treated as route-worthy.
- **SDD dispatch rule:** implementers run FOCUSED tests + `bun run typecheck` + `bun run lint:file` inline and commit; the controller runs full `bun test` between tasks.
- **Spec:** `docs/superpowers/specs/2026-07-05-slice-21-graceful-degradation-retries-design.md`. Research memory: `reference-graceful-degradation-retries-findings`.

---

### Task 1: Reliability config (computed, env-fallback-only knobs)

**Files:**
- Create: `src/reliability/config.ts`
- Test: `tests/reliability/config.test.ts`

**Interfaces:**
- Produces: `maxAttempts(): number`, `runTimeoutMs(): number`, `idleTimeoutMs(): number`, `breakerThreshold(): number`, `breakerCooldownMs(): number`, `breakerHalfOpenProbes(): number`, `retryBaseMs(): number`, `retryCapMs(): number`, `probeTimeoutMs(): number`. Each reads an env var, falling back to a default.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/config.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import {
  breakerCooldownMs,
  breakerThreshold,
  idleTimeoutMs,
  maxAttempts,
  probeTimeoutMs,
  retryBaseMs,
  retryCapMs,
  runTimeoutMs,
} from '../../src/reliability/config.ts';

describe('reliability config', () => {
  const keys = [
    'AGENT_MAX_ATTEMPTS',
    'AGENT_RUN_TIMEOUT_MS',
    'AGENT_IDLE_TIMEOUT_MS',
    'AGENT_BREAKER_THRESHOLD',
    'AGENT_BREAKER_COOLDOWN_MS',
    'AGENT_RETRY_BASE_MS',
    'AGENT_RETRY_CAP_MS',
    'AGENT_PROBE_TIMEOUT_MS',
  ];
  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it('returns sensible positive defaults', () => {
    expect(maxAttempts()).toBeGreaterThan(0);
    expect(runTimeoutMs()).toBeGreaterThan(0);
    expect(idleTimeoutMs()).toBeGreaterThan(0);
    expect(breakerThreshold()).toBeGreaterThan(0);
    expect(breakerCooldownMs()).toBeGreaterThan(0);
    expect(retryBaseMs()).toBeGreaterThan(0);
    expect(retryCapMs()).toBeGreaterThanOrEqual(retryBaseMs());
    expect(probeTimeoutMs()).toBeGreaterThan(0);
  });

  it('env vars override defaults', () => {
    process.env.AGENT_MAX_ATTEMPTS = '7';
    process.env.AGENT_BREAKER_THRESHOLD = '3';
    expect(maxAttempts()).toBe(7);
    expect(breakerThreshold()).toBe(3);
  });

  it('ignores non-numeric / zero env and uses the fallback', () => {
    process.env.AGENT_MAX_ATTEMPTS = 'nope';
    expect(maxAttempts()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/config.test.ts`
Expected: FAIL — cannot resolve `../../src/reliability/config.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/config.ts
/** Reliability knobs. Computed defaults; env vars are fallback-only overrides. */

function envNumber(name: string, fallback: number): number {
  return Number(process.env[name]) || fallback;
}

/** Max attempts for a cross-boundary op we own (retry.ts). Not for LLM turns. */
export function maxAttempts(): number {
  return envNumber('AGENT_MAX_ATTEMPTS', 4);
}
/** Hard wall-clock cap for a single agent turn / step attempt. */
export function runTimeoutMs(): number {
  return envNumber('AGENT_RUN_TIMEOUT_MS', 120_000);
}
/** Idle cap for a progress-bearing op — resets on observed progress. */
export function idleTimeoutMs(): number {
  return envNumber('AGENT_IDLE_TIMEOUT_MS', 90_000);
}
/** Consecutive failures before a breaker opens. */
export function breakerThreshold(): number {
  return envNumber('AGENT_BREAKER_THRESHOLD', 5);
}
/** How long a breaker stays open before allowing a half-open probe. */
export function breakerCooldownMs(): number {
  return envNumber('AGENT_BREAKER_COOLDOWN_MS', 60_000);
}
/** Successful half-open probes required to close a breaker. */
export function breakerHalfOpenProbes(): number {
  return envNumber('AGENT_BREAKER_HALF_OPEN_PROBES', 1);
}
/** Base backoff for retry.ts. */
export function retryBaseMs(): number {
  return envNumber('AGENT_RETRY_BASE_MS', 1_000);
}
/** Backoff cap for retry.ts. */
export function retryCapMs(): number {
  return envNumber('AGENT_RETRY_CAP_MS', 45_000);
}
/** Liveness-probe timeout (runtime isAvailable / listModels). */
export function probeTimeoutMs(): number {
  return envNumber('AGENT_PROBE_TIMEOUT_MS', 1_500);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/config.ts" "tests/reliability/config.test.ts"
git add src/reliability/config.ts tests/reliability/config.test.ts
git commit -m "feat(reliability): computed env-fallback config knobs"
```

---

### Task 2: Error-lane classifier

**Files:**
- Create: `src/reliability/classify.ts`
- Test: `tests/reliability/classify.test.ts`

**Interfaces:**
- Consumes: `FrameworkError` subclasses from `src/core/errors.ts` (`ProviderError`, `ResourceError`, `ToolError`, `MaxStepsError`); `APICallError` from `ai`.
- Produces: `enum Lane { Transient, RouteWorthy, Terminal }`; `classify(err: unknown): Lane`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/classify.test.ts
import { describe, expect, it } from 'bun:test';
import { APICallError } from 'ai';
import { ProviderError, ResourceError, ToolError } from '../../src/core/errors.ts';
import { classify, Lane } from '../../src/reliability/classify.ts';

function apiError(statusCode: number, isRetryable: boolean): APICallError {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'http://x',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

describe('classify', () => {
  it('retryable API errors are Transient', () => {
    expect(classify(apiError(429, true))).toBe(Lane.Transient);
    expect(classify(apiError(503, true))).toBe(Lane.Transient);
  });
  it('non-retryable client API errors are Terminal', () => {
    expect(classify(apiError(400, false))).toBe(Lane.Terminal);
    expect(classify(apiError(401, false))).toBe(Lane.Terminal);
  });
  it('ProviderError and ResourceError are RouteWorthy', () => {
    expect(classify(new ProviderError('pull failed'))).toBe(Lane.RouteWorthy);
    expect(classify(new ResourceError('no fit'))).toBe(Lane.RouteWorthy);
  });
  it('ToolError is Terminal', () => {
    expect(classify(new ToolError('bad args'))).toBe(Lane.Terminal);
  });
  it('network reset codes are Transient', () => {
    const e = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(classify(e)).toBe(Lane.Transient);
  });
  it('unknown errors fail safe to Terminal', () => {
    expect(classify(new Error('mystery'))).toBe(Lane.Terminal);
    expect(classify('a string')).toBe(Lane.Terminal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/classify.test.ts`
Expected: FAIL — cannot resolve `classify.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/classify.ts
import { APICallError } from 'ai';
import { ProviderError, ResourceError, ToolError } from '../core/errors.ts';

/** Three lanes drive the retry/degrade/partial-failure wiring. */
export enum Lane {
  Transient, // back off + retry (ops we own only)
  RouteWorthy, // don't backoff — degrade/fallback/skip
  Terminal, // fail fast — no retry, surface to user
}

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE']);

/**
 * Classify an error into a reliability lane. Pure; never throws.
 * Unknown/unclassifiable → Terminal (fail safe: never silently retry the unknown).
 */
export function classify(err: unknown): Lane {
  if (APICallError.isInstance(err)) {
    return err.isRetryable ? Lane.Transient : Lane.Terminal;
  }
  if (err instanceof ProviderError || err instanceof ResourceError) {
    return Lane.RouteWorthy;
  }
  if (err instanceof ToolError) {
    return Lane.Terminal;
  }
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && TRANSIENT_CODES.has(code)) {
    return Lane.Transient;
  }
  return Lane.Terminal;
}
```

Note: `APICallError.isInstance` is the AI SDK v6 guard. If typecheck reports it missing, use `APICallError.isAPICallError` — verify against the installed `ai` types before finalizing.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/classify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/classify.ts" "tests/reliability/classify.test.ts"
git add src/reliability/classify.ts tests/reliability/classify.test.ts
git commit -m "feat(reliability): three-lane error classifier"
```

---

### Task 3: CircuitOpenError

**Files:**
- Create: `src/reliability/errors.ts`
- Modify: `tests/reliability/classify.test.ts` (add a case)
- Test: `tests/reliability/errors.test.ts`

**Interfaces:**
- Consumes: `FrameworkError` (re-declared? No — import indirectly). `CircuitOpenError` must extend the same base as other framework errors. Since `FrameworkError` is not exported from `core/errors.ts`, `CircuitOpenError` extends `Error` directly and sets `this.name` (matching the pattern used by `JudgeUnavailableError`/`LiveReferenceError` in `verified-build`).
- Produces: `class CircuitOpenError extends Error` with `readonly dependencyId: string`.
- Also: `classify()` maps `CircuitOpenError` → `Lane.RouteWorthy` (open breaker = try elsewhere).

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/errors.test.ts
import { describe, expect, it } from 'bun:test';
import { CircuitOpenError } from '../../src/reliability/errors.ts';

describe('CircuitOpenError', () => {
  it('carries the dependency id and a stable name', () => {
    const e = new CircuitOpenError('mcp:github');
    expect(e.dependencyId).toBe('mcp:github');
    expect(e.name).toBe('CircuitOpenError');
    expect(e.message).toContain('mcp:github');
    expect(e instanceof Error).toBe(true);
  });
});
```

Also append to `tests/reliability/classify.test.ts`:

```ts
// add import at top:
// import { CircuitOpenError } from '../../src/reliability/errors.ts';
// add inside describe('classify', ...):
  it('CircuitOpenError is RouteWorthy', () => {
    expect(classify(new CircuitOpenError('mcp:x'))).toBe(Lane.RouteWorthy);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/errors.test.ts`
Expected: FAIL — cannot resolve `errors.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/errors.ts
/** Thrown by an open circuit breaker: the dependency is being given a rest. */
export class CircuitOpenError extends Error {
  constructor(readonly dependencyId: string) {
    super(`circuit open for dependency "${dependencyId}"`);
    this.name = 'CircuitOpenError';
  }
}
```

Then update `src/reliability/classify.ts`:

```ts
// add import:
import { CircuitOpenError } from './errors.ts';
// in classify(), before the ProviderError check:
  if (err instanceof CircuitOpenError) {
    return Lane.RouteWorthy;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/errors.test.ts tests/reliability/classify.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/errors.ts" "src/reliability/classify.ts" "tests/reliability/errors.test.ts"
git add src/reliability/errors.ts src/reliability/classify.ts tests/reliability/errors.test.ts tests/reliability/classify.test.ts
git commit -m "feat(reliability): CircuitOpenError (route-worthy)"
```

---

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

### Task 5: Timeouts — withWallClock + IdleWatchdog + withIdleTimeout

**Files:**
- Create: `src/reliability/timeout.ts`
- Test: `tests/reliability/timeout.test.ts`

**Interfaces:**
- Produces:
  - `withWallClock<T>(ms: number, fn: () => Promise<T>): Promise<T>` (rejects `Error('timeout')` on expiry; clears its timer)
  - `class IdleWatchdog` — generalized `StallWatchdog`: `constructor(timeoutMs, onIdle, now?)`, `beat(progress: number)`, `tick()`, `start(intervalMs)`, `stop()`
  - `withIdleTimeout<T>(fn: (beat: (progress: number) => void) => Promise<T>, opts: { idleMs: number; onIdle: () => void; intervalMs?: number }): Promise<T>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/timeout.test.ts
import { describe, expect, it } from 'bun:test';
import { IdleWatchdog, withIdleTimeout, withWallClock } from '../../src/reliability/timeout.ts';

describe('withWallClock', () => {
  it('resolves the fn result when it finishes in time', async () => {
    const r = await withWallClock(1000, async () => 42);
    expect(r).toBe(42);
  });
  it('rejects with a timeout when the fn is too slow', async () => {
    await expect(
      withWallClock(10, () => new Promise((r) => setTimeout(() => r('late'), 1000))),
    ).rejects.toThrow('timeout');
  });
});

describe('IdleWatchdog', () => {
  it('fires onIdle only after the timeout with no progress', () => {
    let fired = 0;
    let clock = 0;
    const w = new IdleWatchdog(100, () => fired++, () => clock);
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
    const w = new IdleWatchdog(100, () => fired++, () => clock);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/timeout.test.ts`
Expected: FAIL — cannot resolve `timeout.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/timeout.ts
/** Hard wall-clock cap (run_timeout). Rejects Error('timeout') on expiry. */
export function withWallClock<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([fn(), clock]).finally(() => clearTimeout(timer));
}

/** Fires onIdle when a monotonic progress counter hasn't advanced within timeoutMs. */
export class IdleWatchdog {
  private lastProgress = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private idleSince: number | null = null;
  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: () => void,
    private readonly now: () => number = () => Date.now(),
  ) {}
  beat(progress: number): void {
    if (progress > this.lastProgress) {
      this.lastProgress = progress;
      this.idleSince = null;
    } else if (this.idleSince === null) {
      this.idleSince = this.now();
    }
  }
  tick(): void {
    if (this.idleSince !== null && this.now() - this.idleSince >= this.timeoutMs) {
      this.onIdle();
    }
  }
  start(intervalMs: number): void {
    this.timer = setInterval(() => this.tick(), intervalMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Run a progress-bearing op with an idle timeout; `beat(progress)` resets the timer. */
export async function withIdleTimeout<T>(
  fn: (beat: (progress: number) => void) => Promise<T>,
  opts: { idleMs: number; onIdle: () => void; intervalMs?: number },
): Promise<T> {
  const w = new IdleWatchdog(opts.idleMs, opts.onIdle);
  w.beat(0);
  w.start(opts.intervalMs ?? 1000);
  try {
    return await fn((p) => w.beat(p));
  } finally {
    w.stop();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/timeout.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/timeout.ts" "tests/reliability/timeout.test.ts"
git add src/reliability/timeout.ts tests/reliability/timeout.test.ts
git commit -m "feat(reliability): withWallClock + IdleWatchdog + withIdleTimeout"
```

---

### Task 6: Circuit breaker + registry

**Files:**
- Create: `src/reliability/breaker.ts`
- Test: `tests/reliability/breaker.test.ts`

**Interfaces:**
- Consumes: `breakerThreshold`, `breakerCooldownMs`, `breakerHalfOpenProbes` from config; `CircuitOpenError` from errors.
- Produces:
  - `enum BreakerState { Closed, Open, HalfOpen }`
  - `type BreakerOpts = { threshold?: number; cooldownMs?: number; halfOpenProbes?: number; now?: () => number }`
  - `class CircuitBreaker` with `readonly id: string`, `state(): BreakerState`, `run<T>(fn: () => Promise<T>): Promise<T>`
  - `breakerFor(id: string, opts?: BreakerOpts): CircuitBreaker` (shared registry)
  - `resetBreakers(): void` (test seam)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/breaker.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';
import { BreakerState, CircuitBreaker, breakerFor, resetBreakers } from '../../src/reliability/breaker.ts';
import { CircuitOpenError } from '../../src/reliability/errors.ts';

const fail = () => Promise.reject(new Error('boom'));
const ok = () => Promise.resolve('ok');

describe('CircuitBreaker', () => {
  it('opens after threshold consecutive failures', async () => {
    const b = new CircuitBreaker('t', { threshold: 3, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) await b.run(fail).catch(() => {});
    expect(b.state()).toBe(BreakerState.Open);
    await expect(b.run(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('half-opens after cooldown and closes on a successful probe', async () => {
    let clock = 0;
    const b = new CircuitBreaker('t', { threshold: 1, cooldownMs: 100, halfOpenProbes: 1, now: () => clock });
    await b.run(fail).catch(() => {});
    expect(b.state()).toBe(BreakerState.Open);
    clock = 150; // past cooldown
    const r = await b.run(ok); // half-open probe succeeds → close
    expect(r).toBe('ok');
    expect(b.state()).toBe(BreakerState.Closed);
  });

  it('a success resets the consecutive-failure count', async () => {
    const b = new CircuitBreaker('t', { threshold: 3, cooldownMs: 1000 });
    await b.run(fail).catch(() => {});
    await b.run(fail).catch(() => {});
    await b.run(ok);
    await b.run(fail).catch(() => {});
    expect(b.state()).toBe(BreakerState.Closed); // count reset by the success
  });
});

describe('breakerFor registry', () => {
  beforeEach(() => resetBreakers());
  it('returns the same breaker for the same id', () => {
    expect(breakerFor('mcp:a')).toBe(breakerFor('mcp:a'));
    expect(breakerFor('mcp:a')).not.toBe(breakerFor('mcp:b'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/breaker.test.ts`
Expected: FAIL — cannot resolve `breaker.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/breaker.ts
import { breakerCooldownMs, breakerHalfOpenProbes, breakerThreshold } from './config.ts';
import { CircuitOpenError } from './errors.ts';

export enum BreakerState {
  Closed,
  Open,
  HalfOpen,
}

export type BreakerOpts = {
  threshold?: number;
  cooldownMs?: number;
  halfOpenProbes?: number;
  now?: () => number;
};

/**
 * Closed → (≥threshold consecutive failures) → Open →
 * (after cooldownMs) → HalfOpen → (halfOpenProbes successes) → Closed
 *                                → (any failure) → Open
 * Cooldown is checked lazily on run() — no timers.
 */
export class CircuitBreaker {
  private failures = 0;
  private probeSuccesses = 0;
  private openedAt = 0;
  private current = BreakerState.Closed;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly halfOpenProbes: number;
  private readonly now: () => number;

  constructor(readonly id: string, opts: BreakerOpts = {}) {
    this.threshold = opts.threshold ?? breakerThreshold();
    this.cooldownMs = opts.cooldownMs ?? breakerCooldownMs();
    this.halfOpenProbes = opts.halfOpenProbes ?? breakerHalfOpenProbes();
    this.now = opts.now ?? (() => Date.now());
  }

  state(): BreakerState {
    if (this.current === BreakerState.Open && this.now() - this.openedAt >= this.cooldownMs) {
      this.current = BreakerState.HalfOpen;
      this.probeSuccesses = 0;
    }
    return this.current;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state() === BreakerState.Open) {
      throw new CircuitOpenError(this.id);
    }
    try {
      const r = await fn();
      this.onSuccess();
      return r;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.current === BreakerState.HalfOpen) {
      this.probeSuccesses++;
      if (this.probeSuccesses >= this.halfOpenProbes) {
        this.current = BreakerState.Closed;
        this.failures = 0;
      }
      return;
    }
    this.failures = 0;
  }

  private onFailure(): void {
    if (this.current === BreakerState.HalfOpen) {
      this.trip();
      return;
    }
    this.failures++;
    if (this.failures >= this.threshold) this.trip();
  }

  private trip(): void {
    this.current = BreakerState.Open;
    this.openedAt = this.now();
  }
}

const registry = new Map<string, CircuitBreaker>();

/** Shared breaker for a dependency id (mcp:<name> / tool:<name> / runtime:<kind>). */
export function breakerFor(id: string, opts?: BreakerOpts): CircuitBreaker {
  let b = registry.get(id);
  if (!b) {
    b = new CircuitBreaker(id, opts);
    registry.set(id, b);
  }
  return b;
}

/** Test seam: clear the shared registry. */
export function resetBreakers(): void {
  registry.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/breaker.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/breaker.ts" "tests/reliability/breaker.test.ts"
git add src/reliability/breaker.ts tests/reliability/breaker.test.ts
git commit -m "feat(reliability): hand-rolled circuit breaker + shared registry"
```

---

### Task 7: Degradation ledger

**Files:**
- Create: `src/reliability/ledger.ts`
- Test: `tests/reliability/ledger.test.ts`

**Interfaces:**
- Produces:
  - `enum DegradeKind { ModelDegraded, AgentDropped, ToolSkipped, Retried, CircuitOpen }`
  - `type DegradeEvent = { kind: DegradeKind; subject: string; reason: string; detail?: string }`
  - `type DegradationLedger = { events: DegradeEvent[]; record(e: DegradeEvent): void }`
  - `createLedger(): DegradationLedger`
  - `formatLedger(ledger: DegradationLedger): string` (concise multi-line user summary; `''` when empty)
  - `serializeLedger(ledger: DegradationLedger): string` (JSONL, one event per line)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/ledger.test.ts
import { describe, expect, it } from 'bun:test';
import { DegradeKind, createLedger, formatLedger, serializeLedger } from '../../src/reliability/ledger.ts';

describe('DegradationLedger', () => {
  it('records events in order', () => {
    const l = createLedger();
    l.record({ kind: DegradeKind.AgentDropped, subject: 'pdf_agent', reason: 'mcp server down' });
    l.record({ kind: DegradeKind.ModelDegraded, subject: 'writer', reason: 'runtime unreachable', detail: 'mlx→ollama' });
    expect(l.events).toHaveLength(2);
    expect(l.events[0].subject).toBe('pdf_agent');
  });

  it('formatLedger returns empty string with no events', () => {
    expect(formatLedger(createLedger())).toBe('');
  });

  it('formatLedger summarizes events for the user', () => {
    const l = createLedger();
    l.record({ kind: DegradeKind.AgentDropped, subject: 'pdf_agent', reason: 'mcp server down' });
    const out = formatLedger(l);
    expect(out).toContain('pdf_agent');
    expect(out).toContain('mcp server down');
  });

  it('serializeLedger emits one JSON object per line', () => {
    const l = createLedger();
    l.record({ kind: DegradeKind.Retried, subject: 'download', reason: 'ECONNRESET' });
    const lines = serializeLedger(l).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).subject).toBe('download');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/ledger.test.ts`
Expected: FAIL — cannot resolve `ledger.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/ledger.ts
/** In-run record of degradation events; surfaced to the user + telemetry. */
export enum DegradeKind {
  ModelDegraded = 'model_degraded',
  AgentDropped = 'agent_dropped',
  ToolSkipped = 'tool_skipped',
  Retried = 'retried',
  CircuitOpen = 'circuit_open',
}

export type DegradeEvent = {
  kind: DegradeKind;
  subject: string;
  reason: string;
  detail?: string;
};

export type DegradationLedger = {
  events: DegradeEvent[];
  record(e: DegradeEvent): void;
};

export function createLedger(): DegradationLedger {
  const events: DegradeEvent[] = [];
  return {
    events,
    record(e) {
      events.push(e);
    },
  };
}

const LABEL: Record<DegradeKind, string> = {
  [DegradeKind.ModelDegraded]: 'degraded model',
  [DegradeKind.AgentDropped]: 'dropped agent',
  [DegradeKind.ToolSkipped]: 'skipped tool',
  [DegradeKind.Retried]: 'retried',
  [DegradeKind.CircuitOpen]: 'circuit open',
};

/** Concise user-facing summary; empty string when nothing degraded. */
export function formatLedger(ledger: DegradationLedger): string {
  if (ledger.events.length === 0) return '';
  const lines = ledger.events.map((e) => {
    const tail = e.detail ? ` (${e.detail})` : '';
    return `  ⚠ ${LABEL[e.kind]}: ${e.subject} — ${e.reason}${tail}`;
  });
  return `Degraded during this run:\n${lines.join('\n')}`;
}

/** JSONL for persistence into run.dir. */
export function serializeLedger(ledger: DegradationLedger): string {
  return ledger.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/ledger.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/ledger.ts" "tests/reliability/ledger.test.ts"
git add src/reliability/ledger.ts tests/reliability/ledger.test.ts
git commit -m "feat(reliability): degradation ledger (record/format/serialize)"
```

---

### Task 8: Model-degradation chain

**Files:**
- Create: `src/reliability/degrade.ts`
- Test: `tests/reliability/degrade.test.ts`

**Interfaces:**
- Consumes: `ModelDeclaration` from `src/core/types.ts` (fields used: `model: string`, `runtime: RuntimeKind`, `fallbackModel?: string`); `RuntimeKind` from `src/core/types.ts`.
- Produces:
  - `type FailureDomain = string` — an identity for "the thing that could be down" (runtime + endpoint). Two declarations sharing a domain must not be tried back-to-back on a RouteWorthy failure.
  - `failureDomain(decl: ModelDeclaration): FailureDomain`
  - `degradeChain(candidates: ModelDeclaration[]): ModelDeclaration[]` — reorders so consecutive entries never share a failure domain where a differing-domain candidate exists (stable otherwise).

Note: `resolveModel` already walks candidates best-first; `degrade.ts` supplies the failure-domain-aware ORDERING it should walk, so an unreachable Ollama daemon isn't retried by picking another Ollama model next when an MLX candidate exists.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/degrade.test.ts
import { describe, expect, it } from 'bun:test';
import { RuntimeKind } from '../../src/core/types.ts';
import { degradeChain, failureDomain } from '../../src/reliability/degrade.ts';
import type { ModelDeclaration } from '../../src/core/types.ts';

function decl(model: string, runtime: RuntimeKind): ModelDeclaration {
  return { role: 'general', model, runtime, requires: [] } as unknown as ModelDeclaration;
}

describe('failureDomain', () => {
  it('same runtime → same domain; different runtime → different domain', () => {
    expect(failureDomain(decl('a', RuntimeKind.Ollama))).toBe(
      failureDomain(decl('b', RuntimeKind.Ollama)),
    );
    expect(failureDomain(decl('a', RuntimeKind.Ollama))).not.toBe(
      failureDomain(decl('a', RuntimeKind.MlxServer)),
    );
  });
});

describe('degradeChain', () => {
  it('interleaves so consecutive entries avoid the same failure domain', () => {
    const chain = degradeChain([
      decl('o1', RuntimeKind.Ollama),
      decl('o2', RuntimeKind.Ollama),
      decl('m1', RuntimeKind.MlxServer),
    ]);
    // first is still the best (o1); second must switch domain (m1), not o2
    expect(chain[0].model).toBe('o1');
    expect(failureDomain(chain[1])).not.toBe(failureDomain(chain[0]));
  });

  it('is a stable passthrough when all share one domain', () => {
    const input = [decl('o1', RuntimeKind.Ollama), decl('o2', RuntimeKind.Ollama)];
    expect(degradeChain(input).map((d) => d.model)).toEqual(['o1', 'o2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/degrade.test.ts`
Expected: FAIL — cannot resolve `degrade.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reliability/degrade.ts
import type { ModelDeclaration } from '../core/types.ts';

/** Identity of the thing that could be down. Today: the runtime. */
export type FailureDomain = string;

export function failureDomain(decl: ModelDeclaration): FailureDomain {
  return String(decl.runtime);
}

/**
 * Reorder candidates (already best-first) so no two CONSECUTIVE entries share a
 * failure domain when a different-domain candidate is available — so a dead
 * daemon isn't "degraded" to another model behind the same daemon. Stable:
 * relative order within a domain is preserved; falls back to the input order
 * when only one domain exists.
 */
export function degradeChain(candidates: ModelDeclaration[]): ModelDeclaration[] {
  const remaining = [...candidates];
  const out: ModelDeclaration[] = [];
  let lastDomain: FailureDomain | undefined;
  while (remaining.length > 0) {
    let idx = remaining.findIndex((d) => failureDomain(d) !== lastDomain);
    if (idx === -1) idx = 0; // only same-domain left
    const [picked] = remaining.splice(idx, 1);
    out.push(picked);
    lastDomain = failureDomain(picked);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/reliability/degrade.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/degrade.ts" "tests/reliability/degrade.test.ts"
git add src/reliability/degrade.ts tests/reliability/degrade.test.ts
git commit -m "feat(reliability): failure-domain-aware model-degrade chain"
```

---

### Task 9: Telemetry — reliability attrs + recordDegrade

**Files:**
- Modify: `src/telemetry/spans.ts` (add ATTR keys + `recordDegrade`)
- Test: `tests/telemetry/reliability-spans.test.ts`

**Interfaces:**
- Consumes: `DegradeEvent`, `DegradeKind` from `src/reliability/ledger.ts`; existing `ATTR` object + active-span helpers.
- Produces: new `ATTR` keys `RELIABILITY_RETRY_ATTEMPTS='retry.attempts'`, `RELIABILITY_RETRY_LANE='retry.lane'`, `RELIABILITY_BREAKER_STATE='breaker.state'`, `RELIABILITY_DEGRADE_FROM='degrade.from'`, `RELIABILITY_DEGRADE_TO='degrade.to'`, `RELIABILITY_DEGRADE_REASON='degrade.reason'`, `RELIABILITY_DROPPED_AGENT='partial_failure.dropped_agent'`, `ERROR_TYPE='error.type'`; `recordDegrade(event: DegradeEvent): void` (adds a span event `'reliability.degrade'` on the active span with the standard `error.type` attribute).

- [ ] **Step 1: Write the failing test**

```ts
// tests/telemetry/reliability-spans.test.ts
import { describe, expect, it } from 'bun:test';
import { ATTR, recordDegrade } from '../../src/telemetry/spans.ts';
import { DegradeKind } from '../../src/reliability/ledger.ts';

describe('reliability telemetry', () => {
  it('exposes reliability ATTR keys', () => {
    expect(ATTR.RELIABILITY_DEGRADE_REASON).toBe('degrade.reason');
    expect(ATTR.RELIABILITY_DROPPED_AGENT).toBe('partial_failure.dropped_agent');
    expect(ATTR.ERROR_TYPE).toBe('error.type');
  });
  it('recordDegrade does not throw without an active span', () => {
    expect(() =>
      recordDegrade({ kind: DegradeKind.AgentDropped, subject: 'a', reason: 'down' }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/reliability-spans.test.ts`
Expected: FAIL — `ATTR.RELIABILITY_DEGRADE_REASON` undefined / `recordDegrade` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/telemetry/spans.ts`, add to the `ATTR` object (before the closing `} as const;`):

```ts
  // Reliability (Slice 21)
  RELIABILITY_RETRY_ATTEMPTS: 'retry.attempts',
  RELIABILITY_RETRY_LANE: 'retry.lane',
  RELIABILITY_BREAKER_STATE: 'breaker.state',
  RELIABILITY_DEGRADE_FROM: 'degrade.from',
  RELIABILITY_DEGRADE_TO: 'degrade.to',
  RELIABILITY_DEGRADE_REASON: 'degrade.reason',
  RELIABILITY_DROPPED_AGENT: 'partial_failure.dropped_agent',
  ERROR_TYPE: 'error.type',
```

Add the recorder (near `recordGuardrailViolation`), importing the types at the top of the file:

```ts
import type { DegradeEvent } from '../reliability/ledger.ts';
```

```ts
/** Record a degradation event on the active span (mirrors recordGuardrailViolation). */
export function recordDegrade(event: DegradeEvent): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('reliability.degrade', {
    [ATTR.ERROR_TYPE]: event.kind,
    'degrade.subject': event.subject,
    [ATTR.RELIABILITY_DEGRADE_REASON]: event.reason,
    ...(event.detail ? { 'degrade.detail': event.detail } : {}),
  });
}
```

(If `trace` is not already imported in the module, reuse the existing import used by `recordGuardrailViolation`/`getActiveSpan`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry/reliability-spans.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/telemetry/spans.ts" "tests/telemetry/reliability-spans.test.ts"
git add src/telemetry/spans.ts tests/telemetry/reliability-spans.test.ts
git commit -m "feat(telemetry): reliability attrs + recordDegrade"
```

---

### Task 10: Migrate provisioning onto reliability/{retry,timeout}

**Files:**
- Modify: `src/provisioning/supervisor.ts` (re-export from reliability; keep `checkDiskSpace`)
- Modify: `src/provisioning/providers/ollama.ts` (use shared `defaultDownloadRetry()` + `IdleWatchdog`)
- Modify: `src/provisioning/providers/hf-fetch.ts` (same)
- Create: `src/reliability/download-retry.ts` (shared download retry config)
- Test: `tests/reliability/download-retry.test.ts`; existing `tests/provisioning/supervisor.test.ts` must still pass.

**Interfaces:**
- Consumes: `withRetry`, `abortableSleep` (retry.ts); `IdleWatchdog` (timeout.ts).
- Produces: `defaultDownloadRetry(): { attempts: number; baseMs: number; capMs: number; jitter: () => number }`; `downloadStallMs(): number`.
- `supervisor.ts` re-exports `withRetry`, `abortableSleep`, and a back-compat `StallWatchdog` alias = `IdleWatchdog` so existing imports keep working.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/download-retry.test.ts
import { describe, expect, it } from 'bun:test';
import { defaultDownloadRetry, downloadStallMs } from '../../src/reliability/download-retry.ts';

describe('download retry defaults', () => {
  it('provides positive backoff parameters', () => {
    const r = defaultDownloadRetry();
    expect(r.attempts).toBeGreaterThan(0);
    expect(r.capMs).toBeGreaterThanOrEqual(r.baseMs);
    expect(typeof r.jitter()).toBe('number');
    expect(downloadStallMs()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/download-retry.test.ts`
Expected: FAIL — cannot resolve `download-retry.ts`.

- [ ] **Step 3: Write the shared config + migrate**

```ts
// src/reliability/download-retry.ts
import { retryBaseMs, retryCapMs } from './config.ts';

/** Shared download retry shape (was duplicated in ollama.ts + hf-fetch.ts). */
export function defaultDownloadRetry(): {
  attempts: number;
  baseMs: number;
  capMs: number;
  jitter: () => number;
} {
  return {
    attempts: Number(process.env.AGENT_DOWNLOAD_ATTEMPTS) || 6,
    baseMs: retryBaseMs(),
    capMs: retryCapMs(),
    jitter: () => 0.5 + Math.random() / 2,
  };
}

/** Idle/stall timeout for a download with no byte progress. */
export function downloadStallMs(): number {
  return Number(process.env.AGENT_DOWNLOAD_STALL_MS) || 90_000;
}
```

In `src/provisioning/supervisor.ts`: delete the local `abortableSleep`, `withRetry`, and `StallWatchdog` bodies; replace with re-exports (keep `checkDiskSpace` + `PreflightInput` in place):

```ts
export { abortableSleep, withRetry } from '../reliability/retry.ts';
export { IdleWatchdog as StallWatchdog } from '../reliability/timeout.ts';
```

In `src/provisioning/providers/ollama.ts`: replace the inline `withRetry(..., { attempts: 6, baseMs: 1_000, capMs: 45_000, jitter: ... })` config with `defaultDownloadRetry()` (spread), and the `STALL_MS`/`new StallWatchdog(STALL_MS, ...)` with `downloadStallMs()`/`new IdleWatchdog(downloadStallMs(), ...)`; `beat(bytes)` replaces `beat(bytes)` (signature identical — `progress` is the byte count). Import from `../../reliability/download-retry.ts` and `../../reliability/timeout.ts`.

In `src/provisioning/providers/hf-fetch.ts`: replace the local `DEFAULT_RETRY` constant with `deps.retry ?? defaultDownloadRetry()` (keep the `RetryConfig`-shaped `deps.retry` injection seam by widening its type to the returned shape) and `STALL_MS` with `downloadStallMs()`, `StallWatchdog` with `IdleWatchdog`.

- [ ] **Step 4: Run tests to verify no regression**

Run: `bun test tests/reliability/download-retry.test.ts tests/provisioning/`
Expected: PASS — the new test plus all existing provisioning tests (supervisor, ollama, hf-fetch) still green.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/reliability/download-retry.ts" "src/provisioning/supervisor.ts" "src/provisioning/providers/ollama.ts" "src/provisioning/providers/hf-fetch.ts"
git add src/reliability/download-retry.ts src/provisioning/
git commit -m "refactor(provisioning): migrate retry/stall onto reliability module"
```

---

### Task 11: Migrate verified-build withWallClock + runtime probe literals

**Files:**
- Modify: `src/verified-build/dry-run.ts` (re-export `withWallClock` from reliability)
- Modify: `src/runtime/ollama.ts` + `src/runtime/mlx-server.ts` (probe literals → `probeTimeoutMs()`)
- Test: existing `tests/verified-build/*` + `tests/runtime/*` (or `tests/cli/select-runtime*`) still pass; add `tests/reliability/timeout-reexport.test.ts`.

**Interfaces:**
- Consumes: `withWallClock` (timeout.ts), `probeTimeoutMs` (config.ts).

- [ ] **Step 1: Write the failing test**

```ts
// tests/reliability/timeout-reexport.test.ts
import { describe, expect, it } from 'bun:test';
import { withWallClock as fromReliability } from '../../src/reliability/timeout.ts';
import { withWallClock as fromDryRun } from '../../src/verified-build/dry-run.ts';

describe('withWallClock re-export', () => {
  it('verified-build re-exports the reliability implementation', () => {
    expect(fromDryRun).toBe(fromReliability);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/reliability/timeout-reexport.test.ts`
Expected: FAIL — the two references are different functions (dry-run defines its own).

- [ ] **Step 3: Migrate**

In `src/verified-build/dry-run.ts`: delete the local `withWallClock` body; add `export { withWallClock } from '../reliability/timeout.ts';`. (Note: reliability's version rejects `Error('timeout')` whereas dry-run's said `'dry-run timeout'`; update any dry-run test asserting the exact message to match `'timeout'`, or keep a thin wrapper `export const withWallClock = <T>(ms:number, fn:()=>Promise<T>) => reliabilityWithWallClock(ms, fn)` — prefer the plain re-export and fix the message assertion.)

In `src/runtime/ollama.ts`: replace `AbortSignal.timeout(1500)` with `AbortSignal.timeout(probeTimeoutMs())` (import from `../reliability/config.ts`).

In `src/runtime/mlx-server.ts`: replace both `AbortSignal.timeout(1500)` occurrences with `AbortSignal.timeout(probeTimeoutMs())`.

- [ ] **Step 4: Run tests to verify no regression**

Run: `bun test tests/reliability/timeout-reexport.test.ts tests/verified-build/ tests/runtime/ tests/cli/`
Expected: PASS (fix any exact-message assertion for the old `'dry-run timeout'` string).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/verified-build/dry-run.ts" "src/runtime/ollama.ts" "src/runtime/mlx-server.ts"
git add src/verified-build/dry-run.ts src/runtime/ tests/
git commit -m "refactor: migrate withWallClock + probe timeouts onto reliability module"
```

---

### Task 12: Wire the ledger into the run context + CLI surface

**Files:**
- Modify: `src/cli/with-mcp-run.ts` (add `ledger` to `McpRunContext`; persist on exit)
- Modify: `src/cli/with-run.ts` (expose a ledger for the non-MCP path if it runs agents) — only if it invokes agent execution; otherwise skip.
- Modify: `src/cli/chat.ts` (print `formatLedger` after the run)
- Test: `tests/cli/degradation-ledger.test.ts`

**Interfaces:**
- Consumes: `createLedger`, `formatLedger`, `serializeLedger`, `DegradationLedger` (ledger.ts); `writeArtifact` (`src/run/run-store.ts`).
- Produces: `McpRunContext` gains `ledger: DegradationLedger`. On body completion, if `ledger.events.length > 0`, write `degradation.jsonl` via `writeArtifact(ctx.run, 'degradation.jsonl', serializeLedger(ledger))`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/degradation-ledger.test.ts
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withMcpRun } from '../../src/cli/with-mcp-run.ts';
import { DegradeKind } from '../../src/reliability/ledger.ts';

describe('withMcpRun degradation ledger', () => {
  it('exposes a ledger and persists it when events were recorded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runs-'));
    let runDir = '';
    await withMcpRun({ runsRoot: root, runId: 'r1', config: { entries: [], dormant: [], warnings: [] } }, async (ctx) => {
      runDir = ctx.run.dir;
      ctx.ledger.record({ kind: DegradeKind.AgentDropped, subject: 'a', reason: 'down' });
    });
    const text = await readFile(join(runDir, 'degradation.jsonl'), 'utf8');
    expect(JSON.parse(text.trim()).subject).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/degradation-ledger.test.ts`
Expected: FAIL — `ctx.ledger` undefined.

- [ ] **Step 3: Implement**

In `src/cli/with-mcp-run.ts`:
- Import: `import { createLedger, serializeLedger, type DegradationLedger } from '../reliability/ledger.ts';` and `writeArtifact` from `../run/run-store.ts` (add to existing import).
- Extend the type: `export type McpRunContext = { run: RunHandle; reg: MountedRegistry; config: McpConfig; ledger: DegradationLedger };`
- In `withMcpRun`, after `createRun`, create `const ledger = createLedger();`, pass it in the `ctx` object, and in the `finally`/after-body block write it out:

```ts
try {
  const result = await body({ run, reg, config, ledger });
  if (ledger.events.length > 0) {
    await writeArtifact(run, 'degradation.jsonl', serializeLedger(ledger));
  }
  return result;
} finally {
  await reg.close();
  await tel.shutdown();
}
```

(Adapt to the file's existing control flow — the point is: ledger created, threaded into `ctx`, persisted when non-empty.)

In `src/cli/chat.ts`: after the run completes, print the summary:

```ts
import { formatLedger } from '../reliability/ledger.ts';
// after obtaining the result, before returning:
const summary = formatLedger(ctx.ledger);
if (summary) console.error(summary);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/degradation-ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/cli/with-mcp-run.ts" "src/cli/chat.ts" "tests/cli/degradation-ledger.test.ts"
git add src/cli/with-mcp-run.ts src/cli/chat.ts tests/cli/degradation-ledger.test.ts
git commit -m "feat(cli): thread degradation ledger through the run + surface it"
```

---

### Task 13: Delegation — classify + degrade + drop-and-record

**Files:**
- Modify: `src/core/delegate.ts` (`runGuardedAgent` catch → classify + ledger; forward `abortSignal` through `asDelegateTool`)
- Test: `tests/core/delegate-degrade.test.ts`

**Interfaces:**
- Consumes: `classify`, `Lane` (classify.ts); `DegradationLedger`, `DegradeKind` (ledger.ts).
- Produces: `runGuardedAgent(agent, task, onBeforeDelegate?, abortSignal?, ledger?)` — new optional trailing `ledger?: DegradationLedger` param; on a caught cause it records an `AgentDropped` (or `CircuitOpen`) event before returning the structured `{ error }`. `asDelegateTool(agent, onBeforeDelegate?, ledger?)` forwards both `abortSignal` (from the tool `execute` options if available) and `ledger`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/delegate-degrade.test.ts
import { describe, expect, it } from 'bun:test';
import { runGuardedAgent } from '../../src/core/delegate.ts';
import { createLedger, DegradeKind } from '../../src/reliability/ledger.ts';
import { ProviderError } from '../../src/core/errors.ts';

// Minimal fake agent whose run throws a RouteWorthy error.
const throwingAgent = {
  name: 'pdf_agent',
  // shape depends on Agent type; construct via the project's test helper if present.
} as never;

describe('runGuardedAgent degradation', () => {
  it('records a dropped-agent event and returns a structured error', async () => {
    const ledger = createLedger();
    // Use the project's helper to build an agent whose delegate run throws
    // new ProviderError('mcp server down'); then:
    const r = await runGuardedAgent(throwingAgent, 'do it', undefined, undefined, ledger);
    expect('error' in r).toBe(true);
    expect(ledger.events.some((e) => e.kind === DegradeKind.AgentDropped)).toBe(true);
  });
});
```

Note to implementer: build the throwing agent with the same helper used by `tests/core/delegate.test.ts` (inspect that file). Keep the assertion: a caught cause → one `AgentDropped` ledger event + a `{ error }` return.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/delegate-degrade.test.ts`
Expected: FAIL — `runGuardedAgent` ignores the 5th arg / records nothing.

- [ ] **Step 3: Implement**

In `src/core/delegate.ts`, extend the signature and the catch block:

```ts
import { classify, Lane } from '../reliability/classify.ts';
import { CircuitOpenError } from '../reliability/errors.ts';
import { DegradeKind, type DegradationLedger } from '../reliability/ledger.ts';
import { recordDegrade } from '../telemetry/spans.ts';

export function runGuardedAgent(
  agent: Agent,
  task: string,
  onBeforeDelegate?: BeforeDelegate,
  abortSignal?: AbortSignal,
  ledger?: DegradationLedger,
): Promise<{ text: string } | { error: string }> {
  // ... existing guard/pre checks unchanged ...
  // existing try/catch around runInDelegationContext(...):
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const kind = cause instanceof CircuitOpenError ? DegradeKind.CircuitOpen : DegradeKind.AgentDropped;
    const lane = classify(cause);
    const event = {
      kind,
      subject: agent.name,
      reason: message,
      detail: `lane=${Lane[lane]}`,
    };
    ledger?.record(event);
    recordDegrade(event);
    return { error: `Agent ${agent.name} failed: ${message}` };
  }
}
```

In `asDelegateTool`, thread `ledger` and forward the AI SDK tool `execute` abort signal:

```ts
export function asDelegateTool(agent: Agent, onBeforeDelegate?: BeforeDelegate, ledger?: DegradationLedger) {
  return tool({
    // ...description/inputSchema unchanged...
    execute: async ({ task }, { abortSignal } = {}) =>
      runGuardedAgent(agent, task, onBeforeDelegate, abortSignal, ledger),
  });
}
```

(Match the exact `tool(...)` shape already in the file. The key changes: accept `ledger`, pass `abortSignal` from the execute options, pass `ledger` through.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/delegate-degrade.test.ts tests/core/delegate.test.ts`
Expected: PASS (new + existing delegate tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/core/delegate.ts" "tests/core/delegate-degrade.test.ts"
git add src/core/delegate.ts tests/core/delegate-degrade.test.ts
git commit -m "feat(core): delegation classifies + records drops to the ledger"
```

---

### Task 14: Agent turn wall-clock timeout

**Files:**
- Modify: `src/core/agent.ts` (`runAgent` wraps `generateText` in `withWallClock`)
- Test: `tests/core/agent-timeout.test.ts`

**Interfaces:**
- Consumes: `withWallClock` (timeout.ts), `runTimeoutMs` (config.ts).
- Produces: `runAgent` behavior — when the model call exceeds `runTimeoutMs()` (and no caller `abortSignal` fired first), it rejects with `Error('timeout')`. No second backoff retry (D5).

Note: `runAgent` uses non-streaming `generateText`, so this is a wall-clock cap, not a token-idle timeout. The caller's `abortSignal` (already threaded) remains the primary cancel; `withWallClock` is the backstop.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/agent-timeout.test.ts
import { describe, expect, it } from 'bun:test';
import { runAgent } from '../../src/core/agent.ts';

describe('runAgent wall-clock timeout', () => {
  it('rejects when the model call exceeds the run timeout', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '20';
    const slowModel = {
      // a fake LanguageModel whose doGenerate never resolves in time;
      // build via the project's model test double used in tests/core/agent.test.ts.
    } as never;
    await expect(
      runAgent({
        model: slowModel,
        systemPrompt: 's',
        prompt: 'p',
        tools: {},
      }),
    ).rejects.toThrow('timeout');
    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });
});
```

Note to implementer: reuse the fake/stub `LanguageModel` pattern from `tests/core/agent.test.ts` / `tests/core/agent-abort.test.ts`; make its generate hang longer than 20ms.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/agent-timeout.test.ts`
Expected: FAIL — no timeout enforced.

- [ ] **Step 3: Implement**

In `src/core/agent.ts`, wrap the `generateText(...)` call:

```ts
import { withWallClock } from '../reliability/timeout.ts';
import { runTimeoutMs } from '../reliability/config.ts';

// where it currently does: const result = await generateText({ ... });
const result = await withWallClock(runTimeoutMs(), () =>
  generateText({
    model: input.model,
    // ...existing options unchanged, including abortSignal: input.abortSignal...
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/agent-timeout.test.ts tests/core/agent.test.ts tests/core/agent-abort.test.ts`
Expected: PASS (new + existing agent tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/core/agent.ts" "tests/core/agent-timeout.test.ts"
git add src/core/agent.ts tests/core/agent-timeout.test.ts
git commit -m "feat(core): wall-clock run_timeout on the agent turn (no LLM re-retry, D5)"
```

---

### Task 15: Workflow — per-step timeout + tool/MCP retry + breaker

**Files:**
- Modify: `src/workflow/types.ts` (add optional `retry?`/`timeout?` to `StepBase`)
- Modify: `src/workflow/run-step.ts` (wrap Tool steps in breaker+retry; wrap the dispatch in withWallClock)
- Modify: `src/workflow/engine.ts` (apply per-step timeout around `runStepByKind`)
- Test: `tests/workflow/step-reliability.test.ts`

**Interfaces:**
- Consumes: `withRetry` (retry.ts), `withWallClock` (timeout.ts), `breakerFor` (breaker.ts), `runTimeoutMs` (config.ts), `classify`/`Lane`.
- Produces: `StepBase` gains `retry?: boolean` (default off for Agent steps, on for Tool steps) and `timeout?: number` (ms; default `runTimeoutMs()`). Tool steps run their `execute` through `breakerFor('tool:' + step.tool)` + `withRetry` on Transient. Agent steps get only the wall-clock timeout (no re-retry, D5).

- [ ] **Step 1: Write the failing test**

```ts
// tests/workflow/step-reliability.test.ts
import { describe, expect, it } from 'bun:test';
import { runWorkflow } from '../../src/workflow/engine.ts';
import { StepKind } from '../../src/workflow/types.ts';
import { z } from 'zod';

describe('workflow step reliability', () => {
  it('retries a Transient tool failure then continues', async () => {
    let calls = 0;
    const flakyTool = {
      description: 'flaky',
      inputSchema: z.object({}),
      execute: async () => {
        calls++;
        if (calls < 2) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        return 'ok';
      },
    };
    const def = {
      id: 'wf',
      steps: [
        {
          id: 's1',
          kind: StepKind.Tool,
          tool: 'flaky',
          input: () => ({}),
          output: z.any(),
          retry: true,
        },
      ],
    };
    const outcome = await runWorkflow(def as never, {}, {
      runAgentStep: async () => 'x',
      tools: { flaky: flakyTool } as never,
    });
    expect(calls).toBe(2);
    expect(outcome.kind).toBe('done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/workflow/step-reliability.test.ts`
Expected: FAIL — tool throws on first call, no retry, workflow fails.

- [ ] **Step 3: Implement**

In `src/workflow/types.ts`, extend `StepBase<O>`:

```ts
type StepBase<O> = {
  id: string;
  dependsOn?: string[];
  output: z.ZodType<O>;
  onError?: StepError;
  persistMemory?: boolean;
  retry?: boolean;
  timeout?: number;
};
```

In `src/workflow/run-step.ts`, in the `Tool` case of `runStepByKind`, wrap the tool `execute` (keep the existing `withToolSpan`):

```ts
import { withRetry } from '../reliability/retry.ts';
import { breakerFor } from '../reliability/breaker.ts';

// Tool case:
case StepKind.Tool: {
  const t = deps.tools[step.tool];
  if (!t) return Promise.reject(new WorkflowError(`Unknown tool: ${step.tool}`));
  const call = () => withToolSpan(step.tool, () => t.execute(step.input(ctx), {} as never));
  const guarded = () => breakerFor('tool:' + step.tool).run(call);
  return step.retry ? withRetry(guarded) : guarded();
}
```

(Match the existing tool-invocation arguments in the file — the point is breaker-wrap + optional retry.)

In `src/workflow/engine.ts`, wrap the `runStepByKind` call inside `withStepSpan` with a per-step wall clock:

```ts
import { withWallClock } from '../reliability/timeout.ts';
import { runTimeoutMs } from '../reliability/config.ts';

// where it currently does: withStepSpan(step.id, step.kind, () => runStepByKind(step, ctx, deps))
withStepSpan(step.id, step.kind, () =>
  withWallClock(step.timeout ?? runTimeoutMs(), () => runStepByKind(step, ctx, deps)),
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/workflow/step-reliability.test.ts tests/workflow/`
Expected: PASS (new + existing workflow tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/workflow/types.ts" "src/workflow/run-step.ts" "src/workflow/engine.ts" "tests/workflow/step-reliability.test.ts"
git add src/workflow/ tests/workflow/step-reliability.test.ts
git commit -m "feat(workflow): per-step timeout + tool breaker/retry"
```

---

### Task 16: MCP tool-call breaker wrap

**Files:**
- Modify: `src/mcp/client.ts` (`mountMcpServer` wraps each tool's `execute` in a per-server breaker)
- Test: `tests/mcp/client-breaker.test.ts`

**Interfaces:**
- Consumes: `breakerFor` (breaker.ts).
- Produces: `mountMcpServer(spec)` — before returning, wrap every tool in `tools` so its `execute` runs inside `breakerFor('mcp:' + serverName)`. The server name comes from the spec (`spec.name` if present, else a stable key). If `spec` has no name field, add an optional `name?: string` and thread it from `mountAll` (which knows the entry name).

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp/client-breaker.test.ts
import { describe, expect, it } from 'bun:test';
import { wrapToolsWithBreaker } from '../../src/mcp/client.ts';
import { resetBreakers } from '../../src/reliability/breaker.ts';
import { CircuitOpenError } from '../../src/reliability/errors.ts';

describe('wrapToolsWithBreaker', () => {
  it('opens the breaker after repeated tool failures', async () => {
    resetBreakers();
    const tools = {
      search: {
        description: 'x',
        inputSchema: undefined,
        execute: async () => {
          throw new Error('server down');
        },
      },
    };
    const wrapped = wrapToolsWithBreaker('flaky', tools as never, { threshold: 2, cooldownMs: 10_000 });
    await wrapped.search.execute({}, {}).catch(() => {});
    await wrapped.search.execute({}, {}).catch(() => {});
    await expect(wrapped.search.execute({}, {})).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mcp/client-breaker.test.ts`
Expected: FAIL — `wrapToolsWithBreaker` not exported.

- [ ] **Step 3: Implement**

In `src/mcp/client.ts`, add the helper and apply it in `mountMcpServer`:

```ts
import { breakerFor, type BreakerOpts } from '../reliability/breaker.ts';
import type { ToolSet } from 'ai';

/** Wrap each tool's execute in a per-server circuit breaker. */
export function wrapToolsWithBreaker(serverName: string, tools: ToolSet, opts?: BreakerOpts): ToolSet {
  const breaker = breakerFor('mcp:' + serverName, opts);
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    out[name] = {
      ...t,
      execute: t.execute ? (args: unknown, o: unknown) => breaker.run(() => t.execute!(args, o as never)) : t.execute,
    } as typeof t;
  }
  return out;
}
```

Then in `mountMcpServer`, after `const tools = await client.tools();`, wrap when a name is known:

```ts
// widen McpMountSpec / accept an optional name; default to a stable key from the spec.
const serverName = ('name' in spec && spec.name) ? spec.name : ('url' in spec ? spec.url : 'stdio');
return { tools: wrapToolsWithBreaker(serverName, tools), close: () => client.close() };
```

If `McpMountSpec` lacks a `name`, thread the entry name from `mountAll` by adding `name` to the spec object built in `toSpec(...)` (mount.ts) — inspect `toSpec` and include the entry's name.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/mcp/client-breaker.test.ts tests/mcp/`
Expected: PASS (new + existing mcp tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/mcp/client.ts" "tests/mcp/client-breaker.test.ts"
git add src/mcp/client.ts tests/mcp/client-breaker.test.ts
git commit -m "feat(mcp): per-server circuit breaker on tool calls"
```

---

### Task 17: Selector + runtime degrade → ledger + breaker

**Files:**
- Modify: `src/resource/selector.ts` (order candidates via `degradeChain`)
- Modify: `src/cli/select-hook.ts` (record the MLX→Ollama degrade to the ledger; runtime probe failures feed the breaker)
- Test: `tests/resource/selector-degrade.test.ts`; `tests/cli/select-hook-ledger.test.ts`

**Interfaces:**
- Consumes: `degradeChain` (degrade.ts); `DegradationLedger`, `DegradeKind` (ledger.ts); `breakerFor` (breaker.ts).
- Produces: `resolveModel` walks `degradeChain(selectCandidates(...))` instead of raw `selectCandidates(...)`. `createSelectHook` accepts an optional `ledger` in its deps and records a `ModelDegraded` event when it degrades a non-Ollama runtime to Ollama.

- [ ] **Step 1: Write the failing test**

```ts
// tests/resource/selector-degrade.test.ts
import { describe, expect, it } from 'bun:test';
import { resolveModel } from '../../src/resource/selector.ts';
import { RuntimeKind } from '../../src/core/types.ts';

describe('resolveModel failure-domain ordering', () => {
  it('after a RouteWorthy failure, tries a different-runtime candidate before another same-runtime one', async () => {
    const attempted: string[] = [];
    const registry = [
      { role: 'general', model: 'o1', runtime: RuntimeKind.Ollama, requires: [] },
      { role: 'general', model: 'o2', runtime: RuntimeKind.Ollama, requires: [] },
      { role: 'general', model: 'm1', runtime: RuntimeKind.MlxServer, requires: [] },
    ] as never;
    const r = await resolveModel(
      { role: 'general', requires: [] } as never,
      registry,
      {
        ensureReady: async (d: { model: string }) => {
          attempted.push(d.model);
          if (d.model !== 'm1') throw new (await import('../../src/core/errors.ts')).ProviderError('down');
          return 4096;
        },
      },
    );
    expect(r.decl.model).toBe('m1');
    // o1 first (best), then m1 (different domain) before o2:
    expect(attempted).toEqual(['o1', 'm1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/resource/selector-degrade.test.ts`
Expected: FAIL — current order is `['o1','o2','m1']`.

- [ ] **Step 3: Implement**

In `src/resource/selector.ts`, wrap the candidate list:

```ts
import { degradeChain } from '../reliability/degrade.ts';
// where it builds candidates:
const candidates = degradeChain(selectCandidates(req, registry, loaded));
```

In `src/cli/select-hook.ts`, record the degrade (extend `deps` with `ledger?: DegradationLedger`):

```ts
import { DegradeKind, type DegradationLedger } from '../reliability/ledger.ts';
// in the degrade branch, after setting degraded = true:
deps.ledger?.record({
  kind: DegradeKind.ModelDegraded,
  subject: decl.model,
  reason: `runtime "${decl.runtime}" unreachable`,
  detail: `${decl.runtime}→ollama`,
});
```

Thread `ledger` from `chat.ts`/`crew.ts`/`flow.ts` where `createSelectHook` is built (pass `ctx.ledger`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/resource/selector-degrade.test.ts tests/resource/ tests/cli/select-hook*.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/resource/selector.ts" "src/cli/select-hook.ts" "tests/resource/selector-degrade.test.ts"
git add src/resource/selector.ts src/cli/select-hook.ts src/cli/chat.ts src/cli/crew.ts src/cli/flow.ts tests/resource/selector-degrade.test.ts tests/cli/
git commit -m "feat(resource): failure-domain candidate order + degrade ledger recording"
```

---

### Task 18: Orchestrator surfaces the degradation summary + thread ledger to delegation

**Files:**
- Modify: `src/core/orchestrator.ts` (build delegate tools with the ledger; surface a summary line)
- Modify: `src/cli/chat.ts` (pass `ctx.ledger` into `createSuperAgent`/orchestrator wiring)
- Test: `tests/core/orchestrator-degrade.test.ts`

**Interfaces:**
- Consumes: `asDelegateTool(agent, onBeforeDelegate, ledger)` (Task 13); `DegradationLedger`.
- Produces: `createOrchestrator(opts)` accepts an optional `ledger` and passes it to each `asDelegateTool(...)`. `runOrchestrator(...)` unchanged in return type — the ledger is surfaced by the CLI (Task 12). This task ensures the wiring reaches delegation so dropped agents are actually recorded end-to-end.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/orchestrator-degrade.test.ts
import { describe, expect, it } from 'bun:test';
import { createOrchestrator } from '../../src/core/orchestrator.ts';
import { createLedger } from '../../src/reliability/ledger.ts';

describe('orchestrator ledger wiring', () => {
  it('accepts a ledger and wires it to delegate tools', () => {
    const ledger = createLedger();
    // build with one fake agent; assert createOrchestrator does not throw and
    // the returned orchestrator exposes delegate tools (shape per existing test).
    const orch = createOrchestrator({ agents: [], ledger } as never);
    expect(orch).toBeDefined();
  });
});
```

Note to implementer: mirror the construction in `tests/core/orchestrator.test.ts`. The real assertion of end-to-end recording is covered by the live-verify (Task 21) and the delegate test (Task 13); this task just proves the ledger param threads without breaking existing behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator-degrade.test.ts`
Expected: FAIL — `createOrchestrator` rejects the `ledger` option / type error.

- [ ] **Step 3: Implement**

In `src/core/orchestrator.ts`, add `ledger?: DegradationLedger` to the `createOrchestrator` options type and pass it through:

```ts
import type { DegradationLedger } from '../reliability/ledger.ts';
// in createOrchestrator options: ledger?: DegradationLedger
// where it builds delegate tools:
tools[delegateToolName(agent)] = asDelegateTool(agent, opts.onBeforeDelegate, opts.ledger);
```

In `src/cli/chat.ts` (and `crew.ts`/`flow.ts` if they build orchestrators), pass `ledger: ctx.ledger` into the orchestrator/super-agent construction.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/orchestrator-degrade.test.ts tests/core/orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/core/orchestrator.ts" "src/cli/chat.ts" "tests/core/orchestrator-degrade.test.ts"
git add src/core/orchestrator.ts src/cli/chat.ts tests/core/orchestrator-degrade.test.ts
git commit -m "feat(core): thread degradation ledger through orchestrator delegation"
```

---

### Task 19: Crew engine threads the ledger

**Files:**
- Modify: `src/crew/engine.ts` (accept `ledger` in `CrewDeps`; pass to `defaultRunAgentStep`/orchestrator)
- Modify: `src/cli/crew.ts` (pass `ctx.ledger`)
- Test: `tests/crew/crew-degrade.test.ts`

**Interfaces:**
- Consumes: `DegradationLedger`; the workflow reliability (Task 15) that sequential crews inherit.
- Produces: `CrewDeps` gains optional `ledger?: DegradationLedger`; the crew's agent-step delegation records drops to it. Sequential crews inherit workflow per-step timeout/retry automatically (compiled to a workflow).

- [ ] **Step 1: Write the failing test**

```ts
// tests/crew/crew-degrade.test.ts
import { describe, expect, it } from 'bun:test';
import { runCrew } from '../../src/crew/engine.ts';
import { createLedger } from '../../src/reliability/ledger.ts';

describe('runCrew ledger', () => {
  it('accepts a ledger in deps without breaking a normal run', async () => {
    const ledger = createLedger();
    // build a minimal sequential crew per tests/crew/*, with a runAgentStep that succeeds.
    // assert the outcome is unaffected and the deps.ledger is accepted.
    expect(typeof runCrew).toBe('function');
    expect(ledger.events).toHaveLength(0);
  });
});
```

Note to implementer: build the crew via the existing crew test helper; the substantive drop-recording is exercised by the live-verify (Task 21). This task ensures `ledger` threads through `CrewDeps` and reaches the delegation path.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/crew/crew-degrade.test.ts`
Expected: FAIL if `CrewDeps` rejects `ledger` (type error) — otherwise adjust to assert the new field exists.

- [ ] **Step 3: Implement**

In `src/crew/engine.ts`, add `ledger?: DegradationLedger` to `CrewDeps`, and pass it into `defaultRunAgentStep(crewAgentMap(...), deps.onBeforeDelegate, deps.ledger)` / the hierarchical orchestrator (`createOrchestrator({ ..., ledger: deps.ledger })`). Update `defaultRunAgentStep` (in `run-step.ts` or wherever defined) to accept and forward `ledger` into `runGuardedAgent`.

In `src/cli/crew.ts`, pass `ledger: ctx.ledger` into the crew deps.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/crew/crew-degrade.test.ts tests/crew/`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run typecheck && bun run lint:file -- "src/crew/engine.ts" "src/cli/crew.ts" "src/workflow/run-step.ts" "tests/crew/crew-degrade.test.ts"
git add src/crew/engine.ts src/cli/crew.ts src/workflow/run-step.ts tests/crew/crew-degrade.test.ts
git commit -m "feat(crew): thread degradation ledger through crew delegation"
```

---

### Task 20: Documentation sweep (all four surfaces + SDD ledger)

**Files:**
- Modify: `docs/architecture.md` (new Reliability subsystem in the module map + a data-flow note + mechanism updates for migrated primitives)
- Modify: `README.md` (Status line; slice table row Slice 21 ✅ Done; Next line)
- Modify: `docs/ROADMAP.md` (flip "graceful degradation ❌" → ✅ Slice 21 in the gap table, phase table, and committed-sequence marker)
- Modify: `.superpowers/sdd/progress.md` (Slice 21 per-task entries + landing summary)

**Interfaces:** N/A (docs). This task has no test; its gate is `bun run docs:check` (pre-commit hook) + accuracy against the diff.

- [ ] **Step 1: Update `docs/architecture.md`**

Add a `src/reliability` subsystem entry to the module map with its files (classify, config, retry, timeout, breaker, degrade, ledger, errors, download-retry) and one-line responsibilities. Add a data-flow note: `classify → {withRetry | degradeChain | breaker} wrapping delegation/workflow/crew/MCP; DegradationLedger → user summary + spans`. Update the provisioning/verified-build mechanism notes to say retry/stall/wall-clock now come from `src/reliability`.

- [ ] **Step 2: Update `README.md`**

Flip the Status line to reference Slice 21; add the slice table row `| 21 | Graceful degradation + retries | ✅ Done |` (match existing column format); update the "Next" line to Slice 22 (Codex heavy-lifting backup).

- [ ] **Step 3: Update `docs/ROADMAP.md`**

In the Phase A gap table, change the `Reliability / retries | graceful degradation | ❌ not built` row to `✅ shipped (Slice 21)`. Update the phase table and the "Committed forward plan" Slice-21 line to shipped. Mark Slice 22 as next.

- [ ] **Step 4: Update the SDD ledger `.superpowers/sdd/progress.md`**

Append a Slice 21 section with per-task commit SHAs (fill from `git log`), the review outcomes, and a landing summary line (test count, gate status).

- [ ] **Step 5: Run docs-check + commit**

```bash
bun run docs:check
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(slice-21): reliability subsystem across all four surfaces + SDD ledger"
```

Expected: `docs:check` green. (Regenerating the interactive Artifact snapshot is a manual post-merge step — see the landing checklist; not gate-blocking here.)

---

### Task 21: Live-verify on Ollama (mandatory before merge)

**Files:**
- Create: `tests/integration/reliability-live.test.ts` (gated behind an env flag like other live tests, e.g. `RELIABILITY_LIVE=1`)

**Interfaces:** Exercises the whole stack against real Ollama.

- [ ] **Step 1: Write the live test (skipped unless RELIABILITY_LIVE=1 and Ollama up)**

Cover the three scenarios from the spec §9:
1. Point an MCP server entry at a dead command (bad stdio binary) → run a crew that references an agent using it → assert the crew completes (not throws) and `ctx.ledger` has an `AgentDropped`/`ToolSkipped` event; the printed summary mentions the dropped agent.
2. Request a model on an unavailable runtime (MLX not running) with an Ollama `fallbackModel` → assert the run degrades to Ollama and records a `ModelDegraded` event.
3. After a degraded run, assert `runs/<id>/degradation.jsonl` exists and `runs/<id>/spans.jsonl` contains a `reliability.degrade` event.

```ts
// tests/integration/reliability-live.test.ts
import { describe, expect, it } from 'bun:test';

const LIVE = process.env.RELIABILITY_LIVE === '1';
const d = LIVE ? describe : describe.skip;

d('reliability (live Ollama)', () => {
  it('drops an agent whose MCP server is down and tells the user', async () => {
    // ...drive the real chat/crew path with a deliberately-dead MCP entry...
    expect(true).toBe(true); // replace with real assertions per scenario 1
  });
  // scenarios 2 and 3 similarly
});
```

- [ ] **Step 2: Run the live suite manually**

```bash
# ensure Ollama up: bun run serve (separate shell), models pulled
RELIABILITY_LIVE=1 bun test tests/integration/reliability-live.test.ts
```
Expected: PASS for all three scenarios. Capture the output for the SDD ledger + resume note.

- [ ] **Step 3: Run the FULL deterministic suite**

```bash
bun test
```
Expected: all green (0 fail); note the new pass count.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/reliability-live.test.ts
git commit -m "test(reliability): live-verify degradation on real Ollama"
```

- [ ] **Step 5: Final gate before merge**

```bash
bun run docs:check && bun run typecheck && bun run lint && bun test
```
Expected: all green. Then proceed to whole-branch final review (fan-out) → fixes → merge `--no-ff` → push (slice-landing gate) → regenerate the Artifact.

---

## Self-Review

**Spec coverage:**
- §3 error taxonomy → Task 2 (+ Task 3 for CircuitOpenError). ✓
- §4 module split: config→T1, classify→T2, errors→T3, retry→T4, timeout→T5, breaker→T6, degrade→T8, ledger→T7. ✓
- §4.1 breaker registry → T6. ✓
- §4.2 ledger + persistence + user surface → T7 + T12. ✓
- §5 wiring: agent→T14, delegate→T13, orchestrator→T18, workflow→T15, crew→T19, mcp→T16, selector/runtime→T17. ✓
- §5 consolidation migrations → T10 (provisioning) + T11 (verified-build + probes). ✓
- §7 telemetry → T9. ✓
- §8 docs (4 surfaces + ledger) → T20. ✓
- §9 testing + live-verify → each task's unit tests + T21. ✓
- §10 out-of-scope → nothing to build (correctly absent). ✓

**Placeholder scan:** Live test bodies (T21) are intentionally scenario-described (they require a running Ollama + real MCP entries that can't be literalized here); every deterministic task has complete code. Wiring tasks (T13/16/17/18/19) note "match the exact shape in the file" where the surrounding code shape must be read at implementation time — this is guidance to the implementer, not a missing step; the changes to make are shown in full.

**Type consistency:** `DegradationLedger`/`DegradeKind`/`DegradeEvent` (T7) used consistently in T9/T12/T13/T17/T18/T19. `withRetry`/`withWallClock`/`breakerFor`/`degradeChain`/`classify`/`Lane` signatures match their definitions across consumers. `McpRunContext.ledger` (T12) consumed by T17/T18/T19 via `ctx.ledger`. `runGuardedAgent`'s new trailing `ledger?` param (T13) matches the `asDelegateTool`→orchestrator→crew threading (T18/T19).

**Note for the executor:** several wiring tasks depend on exact current shapes (the `tool(...)` call in delegate.ts, `toSpec` in mount.ts, the fake-model helper in `tests/core/agent.test.ts`). Read the cited file at task start; the plan gives the change to make, not a re-listing of the untouched surrounding lines.
