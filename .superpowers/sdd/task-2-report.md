# Task 2 Report: Retrieval Injection Budget (Live Fraction of num_ctx)

## Summary
Implemented `src/memory/budget.ts` — a 17-line module that computes the LIVE budget (in chars) for memory injection into agent prompts. Mirrors the `returnCapChars`/`returnCtxFraction` pattern from `src/core/guardrails.ts`. Follows TDD methodology: failing test → implement → all tests passing.

## Implementation

**Files Created:**
- `src/memory/budget.ts` — Budget calculation module (17 lines)
- `tests/memory/budget.test.ts` — Test suite (4 tests, all passing)

**Exports:**
- `retrievalCtxFraction(): number` — Returns env `AGENT_MEMORY_CTX_FRACTION` (range 0–1, default 0.25)
- `retrievalBudgetChars(callerNumCtx?: number): number` — Computes `Math.floor(fraction × ctx × 4)` where ctx falls back to 4096 if undefined

## TDD Evidence

### Step 1: Failing Test ✓
Created test file with 4 test cases covering:
- Scaling with num_ctx (16384 tokens)
- Fallback to 4096 when ctx unknown
- Environment variable honor (0.5 fraction)
- Out-of-range fraction rejection (3 → 0.25)

### Step 2: Verify Fail ✓
```
# Unhandled error between tests
error: Cannot find module '../../src/memory/budget.ts'
```

### Step 3: Implementation ✓
Wrote `src/memory/budget.ts` with:
- Constants: `CHARS_PER_TOKEN = 4`, `FALLBACK_CTX = 4096`
- `retrievalCtxFraction()`: env validation (0 < x ≤ 1) → default 0.25
- `retrievalBudgetChars()`: computes live budget; mirrors guardrails pattern exactly

### Step 4: Verify Pass ✓
```
bun test v1.3.11
 4 pass
 0 fail
 5 expect() calls
Ran 4 tests across 1 file. [6.00ms]
```

### Step 5: Commit ✓
```
[slice-12-memory-rag 9413fe3] feat(memory): live retrieval injection budget (fraction of num_ctx)
 2 files changed, 39 insertions(+)
```

**Pre-commit hook:** `docs-check` passed (no new src subsystems introduced; budget.ts is within existing memory subsystem).

## Code Quality

**Design Consistency:**
- Mirrors `returnCapChars` signature, logic, and constants from guardrails
- Uses same validation pattern for env fractions (0 < x ≤ 1)
- Fallback-only env var (no hard-coded tuning)
- Constants properly documented

**Test Coverage:**
- Default fraction (0.25)
- Env override (0.5)
- Out-of-range rejection (3 → fallback)
- Scaling arithmetic (16384, 8192 contexts)
- Fallback ctx (undefined → 4096)

## Self-Review

✓ No imports from other Slice-12 files (standalone module)
✓ Test import uses `bun:test` (matches project convention)
✓ No console.log statements
✓ Types align (number | undefined handling)
✓ Env var defaults to 0.25 (matches guardrails fraction default)
✓ Math.floor applied (matches guardrails)
✓ Comments align with guardrails style

## Concerns
None. Module is minimal, well-tested, and follows established patterns.
