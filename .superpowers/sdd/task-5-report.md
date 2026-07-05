# Task 5 Report: Timeouts — withWallClock + IdleWatchdog + withIdleTimeout

## Status
✅ **COMPLETE** — All 5 tests pass, typecheck clean, lint clean, committed.

## Implementation Summary

Created `src/reliability/timeout.ts` with three core exports:

1. **`withWallClock<T>(ms: number, fn: () => Promise<T>): Promise<T>`**
   - Hard wall-clock timeout cap using `Promise.race()`
   - Rejects `Error('timeout')` on expiry
   - Clears timer via `.finally()` to prevent leaks

2. **`class IdleWatchdog`**
   - Generalized stall watchdog: fires `onIdle()` when monotonic progress counter stops advancing
   - Constructor: `(timeoutMs, onIdle, now?)` — injectable clock for deterministic tests
   - `beat(progress: number)` — resets idle timer on progress advancement
   - `tick()` — checks if idle timeout exceeded
   - `start(intervalMs)` and `stop()` — manage interval-driven tick polling
   - **Implementation note:** `lastProgress` initialized to `0` (not `-1` as in brief) to correctly trigger idle tracking on first `beat(0)` call

3. **`withIdleTimeout<T>(fn: (beat) => Promise<T>, opts)`**
   - Runs an async operation with idle timeout
   - Passes `beat(progress)` callback to the function
   - Wraps watchdog lifecycle: `start()` at entry, `stop()` in finally block
   - Default interval: 1000ms if not specified

## TDD Sequence
- **Step 1 (FAIL):** Wrote tests in `tests/reliability/timeout.test.ts` → ran, failed with "Cannot find module"
- **Step 2 (IMPLEMENT):** Created `src/reliability/timeout.ts` with all three exports
- **Step 3 (FIX):** Corrected `lastProgress` initialization from `-1` to `0` after first test run revealed semantic issue
- **Step 4 (PASS):** All 5 tests pass; formatted code to meet lint requirements
- **Step 5 (COMMIT):** Typecheck clean, lint clean, committed

## Test Coverage

All 5 tests passing:
- `withWallClock` > resolves on success ✓
- `withWallClock` > rejects with timeout on slow fn ✓
- `IdleWatchdog` > fires onIdle only after timeout with no progress ✓
- `IdleWatchdog` > resets idle timer on progress ✓
- `withIdleTimeout` > passes beat fn and returns result ✓

Tests use injectable `now: () => number` for deterministic clock control (no real timers/intervals).

## Commits
- `d5ed74f` — `feat(reliability): withWallClock + IdleWatchdog + withIdleTimeout`

## Implementation Note: Brief Deviation
The brief code had `lastProgress = -1`, but the tests required `lastProgress = 0`. With `-1` as initial, `beat(0)` advances progress (0 > -1), so `idleSince` remained null and idle timeout never fired. With `lastProgress = 0`, `beat(0)` does not advance (0 is not > 0), triggering the else-if that sets `idleSince = now()`, correctly starting idle tracking on the first beat call. This matches the test's intent ("start tracking at time 0") and the semantic contract: idle tracking begins when we first check progress, not on the second check.

## Checks Passed
- ✅ `bun test tests/reliability/timeout.test.ts` — 5/5 pass
- ✅ `bun run typecheck` — no errors
- ✅ `bun run lint:file` — no violations (formatting fixed)
- ✅ `git commit` — pre-commit docs-check passed

## Bug Fix: IdleWatchdog Silent-Stall Detection

**Commit:** `11e6d51` — `fix(reliability): IdleWatchdog detects silent stalls via lastAdvanceAt timestamp`

**Bug:** `IdleWatchdog.tick()` only fired `onIdle()` if a prior `beat()` call was non-advancing (arming `idleSince`). A realistic stall — progress advances, then goes totally silent (no further `beat()` calls) — was never detected, because `idleSince` stayed null.

**Fix:** Replaced the `idleSince` flag with a `lastAdvanceAt` timestamp that measures elapsed time since the last progress advancement. `tick()` now fires `onIdle()` whenever `now() - lastAdvanceAt >= timeoutMs`, detecting silent stalls regardless of prior beat patterns.

**Changes:**
- Replaced `idleSince: number | null` with `lastAdvanceAt: number`, initialized in constructor
- `beat(progress)` updates `lastAdvanceAt` whenever progress advances
- `tick()` compares elapsed time against `lastAdvanceAt`, not a flag
- Added test: "fires onIdle when progress goes silent after advancing (the classic hang)" — verifies detection of a hung download/op that stops calling beat entirely

**Verification:**
- `bun test tests/reliability/timeout.test.ts` — 6/6 pass (existing 5 tests + new silent-stall test)
- `bun run typecheck` — clean
- `bun run lint:file -- "src/reliability/timeout.ts" "tests/reliability/timeout.test.ts"` — clean

## Notes for Future Tasks
- Task 11 (verified-build) will re-export `withWallClock`
- Task 10 (provisioning) will alias `IdleWatchdog` as `StallWatchdog`
- Signatures stable and ready for downstream use
