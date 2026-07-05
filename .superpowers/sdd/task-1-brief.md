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

