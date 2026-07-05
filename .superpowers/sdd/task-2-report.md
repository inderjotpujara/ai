# Task 2 Report: Three-Lane Error Classifier (Slice 21)

> Slice 21 Task 2: Error-lane classifier for reliability module.
> Slice 19 Task 2 (safe-helpers.ts) preserved in git history.

## Status

**COMPLETED**

## Implementation Summary

Implemented the error-lane classifier for Slice 21's reliability module, mapping errors into three lanes (Transient, RouteWorthy, Terminal) to drive retry/degrade/partial-failure decisions.

## Files Created

- `src/reliability/classify.ts` (28 lines) — `enum Lane` + `classify(err: unknown): Lane` pure function
- `tests/reliability/classify.test.ts` (46 lines) — 6 test cases covering all classification branches

## TDD Evidence

**RED** (Step 1 — Test fails, module doesn't exist):
```
$ bun test tests/reliability/classify.test.ts
error: Cannot find module 'src/reliability/classify.ts'
```

**GREEN** (Step 4 — Test passes after implementation):
```
$ bun test tests/reliability/classify.test.ts
✓ 6 pass
✓ 0 fail
✓ 10 expect() calls
Ran 6 tests across 1 file. [55.00ms]
```

All six test cases pass:
- ✓ retryable API errors are Transient (429, 503 with isRetryable=true)
- ✓ non-retryable client API errors are Terminal (400, 401 with isRetryable=false)
- ✓ ProviderError and ResourceError are RouteWorthy
- ✓ ToolError is Terminal
- ✓ network reset codes (ECONNRESET, ETIMEDOUT, ECONNREFUSED, EPIPE) are Transient
- ✓ unknown errors fail safe to Terminal (Error, string, any non-error)

## APICallError Guard Verification

**Guard Selected:** `APICallError.isInstance(err)`

**Verification Method:**
1. Checked `/node_modules/@ai-sdk/provider/dist/index.d.ts` for APICallError class definition
2. Found: `static isInstance(error: unknown): error is APICallError`
3. Ran `bun run typecheck` — passed with no errors
4. Test constructs `new APICallError({...})` and classify() correctly identifies it

**Status:** ✅ CONFIRMED
- The guard is a proper TypeScript type predicate (error is APICallError)
- Provides correct type narrowing after the check
- Verified in ai package v6 (@ai-sdk/provider re-export)

## Quality Checks

**Typecheck:**
```
$ bun run typecheck
✓ tsc --noEmit
(clean, no output)
```

**Lint:**
```
$ bun run lint:file -- src/reliability/classify.ts tests/reliability/classify.test.ts
✓ Checked 2 files in 3ms. No fixes applied.
```
Formatting adjustments applied (Biome line-width rules):
- TRANSIENT_CODES Set expanded to multi-line
- Test imports expanded to multi-line

**Commit:**
```
$ git commit -m "feat(reliability): three-lane error classifier"
[slice-21-graceful-degradation-retries e8a1870] feat(reliability): three-lane error classifier
 2 files changed, 81 insertions(+)
 create mode 100644 src/reliability/classify.ts
 create mode 100644 tests/reliability/classify.test.ts
✓ docs-check: living docs present + linked; every src subsystem documented.
```

## Implementation Details

### Lane Classifications

**Transient** (back off + retry):
- `APICallError` with `isRetryable=true` (HTTP 429, 503, etc.)
- OS network errors with code in {ECONNRESET, ETIMEDOUT, ECONNREFUSED, EPIPE}

**RouteWorthy** (degrade/fallback/skip, don't retry):
- `ProviderError` — model provider/runtime failed (Ollama unreachable, pull failed)
- `ResourceError` — model doesn't fit memory budget

**Terminal** (fail fast, surface to user):
- `APICallError` with `isRetryable=false` (HTTP 400, 401, etc.)
- `ToolError` — tool invocation failed in unrecoverable way
- Unknown/unclassifiable errors (fail-safe: never silently retry the unknown)

### Code Quality

- ✅ Pure function: never throws, never modifies state
- ✅ `enum` used for finite named set (Lane)
- ✅ Early returns in classify()
- ✅ Exhaustive error handling (unknown → Terminal as safe default)
- ✅ Type guards (instanceof, APICallError.isInstance) all verified
- ✅ No console.log, no unnecessary side effects
- ✅ .ts extensions on all imports
- ✅ Integrates cleanly with `src/core/errors.ts` framework error classes

## Self-Review

**Strengths:**
- Classification logic is exhaustive: every branch either matches a specific error type or falls through to Terminal
- Safe by design: unknown/unclassifiable errors default to Terminal (fail-safe: never retry the unknown)
- Type guards verified and correct (APICallError.isInstance confirmed in ai SDK v6)
- All test cases pass consistently
- Typecheck and lint clean after formatting fixes

**Concerns:**
None. The implementation matches the brief exactly, guards are verified, and all quality gates pass.

## Key Findings

The three-lane model is production-ready:
- APICallError type guard (isInstance) is the correct and reliable way to detect AI SDK errors in v6
- Framework error instanceof checks (ProviderError, ResourceError, ToolError) work as expected
- Network error code detection handles generic Error objects with optional code property
- Unknown errors fail safe to Terminal — the right behavior for untrusted inputs

This classifier is ready for wiring into the retry/degrade logic in subsequent reliability-module tasks (delay, backoff, fallback mechanisms).

## Minor Fix (Post-Implementation)

**Fix:** Converted `Lane` enum from numeric to string-valued (per project convention in root CLAUDE.md).
- Changed: `Transient`, `RouteWorthy`, `Terminal` to `Transient = 'Transient'`, etc.
- Logic unchanged: enum-identity comparisons in `classify()` remain unaffected.

**Test result:** `bun test tests/reliability/classify.test.ts` → 6 pass, 0 fail
**Commit:** `9b17c89` — fix(reliability): Lane as string enum per project convention
