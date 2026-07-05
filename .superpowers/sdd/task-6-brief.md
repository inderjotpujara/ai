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

