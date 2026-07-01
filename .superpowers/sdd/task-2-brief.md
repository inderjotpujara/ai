## Task 2: Retrieval injection budget (live fraction of num_ctx)

**Files:**
- Create: `src/memory/budget.ts`
- Test: `tests/memory/budget.test.ts`

**Interfaces:**
- Produces: `retrievalCtxFraction(): number` (env `AGENT_MEMORY_CTX_FRACTION`, default `0.25`); `retrievalBudgetChars(callerNumCtx: number | undefined): number`.
- Consumes: `currentDelegationContext` from `src/core/guardrails.ts` (read at call site in retrieve, not here).

- [ ] **Step 1: Write the failing test**
```ts
// tests/memory/budget.test.ts
import { afterEach, describe, expect, test } from 'vitest';
import { retrievalBudgetChars, retrievalCtxFraction } from '../../src/memory/budget.ts';

afterEach(() => { delete process.env.AGENT_MEMORY_CTX_FRACTION; });

describe('retrieval budget', () => {
  test('scales with num_ctx (fraction × ctx × 4 chars/token)', () => {
    expect(retrievalBudgetChars(16384)).toBe(Math.floor(0.25 * 16384 * 4));
  });
  test('falls back to 4096 when ctx unknown', () => {
    expect(retrievalBudgetChars(undefined)).toBe(Math.floor(0.25 * 4096 * 4));
  });
  test('honors AGENT_MEMORY_CTX_FRACTION', () => {
    process.env.AGENT_MEMORY_CTX_FRACTION = '0.5';
    expect(retrievalCtxFraction()).toBe(0.5);
    expect(retrievalBudgetChars(8192)).toBe(Math.floor(0.5 * 8192 * 4));
  });
  test('ignores out-of-range fraction', () => {
    process.env.AGENT_MEMORY_CTX_FRACTION = '3';
    expect(retrievalCtxFraction()).toBe(0.25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bun test tests/memory/budget.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/memory/budget.ts`** (mirrors `returnCapChars` in guardrails)
```ts
/** ~chars per token (English approximation). A unit conversion, not a tunable. */
const CHARS_PER_TOKEN = 4;
/** Context floor when a caller's num_ctx is unknown (mirrors guardrails FALLBACK_CTX). */
const FALLBACK_CTX = 4096;

/** Fraction of the caller's context that retrieved memory may occupy.
 *  Env AGENT_MEMORY_CTX_FRACTION (fallback-only), default 0.25. */
export function retrievalCtxFraction(): number {
  const raw = Number(process.env.AGENT_MEMORY_CTX_FRACTION);
  return raw > 0 && raw <= 1 ? raw : 0.25;
}

/** LIVE char budget for memory injected into an agent with `callerNumCtx` tokens. */
export function retrievalBudgetChars(callerNumCtx: number | undefined): number {
  const ctx = callerNumCtx && callerNumCtx > 0 ? callerNumCtx : FALLBACK_CTX;
  return Math.floor(retrievalCtxFraction() * ctx * CHARS_PER_TOKEN);
}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `bun test tests/memory/budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/memory/budget.ts tests/memory/budget.test.ts
git commit -m "feat(memory): live retrieval injection budget (fraction of num_ctx)"
```

---

