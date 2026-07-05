# Task 6 Report (Slice 21) — Circuit breaker + shared registry

**Status:** DONE
**Branch:** slice-21-graceful-degradation-retries
**Commit:** 5522925 — feat(reliability): hand-rolled circuit breaker + shared registry

## Summary
Implemented hand-rolled circuit breaker with shared registry for `src/reliability/breaker.ts` following TDD methodology from the brief, with **mandatory string-enum deviation** per project convention (root CLAUDE.md: "prefer enum over string literal unions").

## What was implemented

### src/reliability/breaker.ts
- `enum BreakerState { Closed = 'Closed', Open = 'Open', HalfOpen = 'HalfOpen' }` (string values, per project convention)
- `type BreakerOpts` — optional overrides for threshold, cooldownMs, halfOpenProbes, now()
- `class CircuitBreaker(id, opts)` with three-state machine:
  - **Closed** → (≥threshold consecutive failures) → **Open**
  - **Open** → (after cooldownMs elapses, checked lazily) → **HalfOpen**
  - **HalfOpen** → (≥halfOpenProbes successes) → **Closed**; (any failure) → **Open**
  - `state(): BreakerState` (lazy cooldown check)
  - `run<T>(fn): Promise<T>` (throws CircuitOpenError when Open)
- `breakerFor(id, opts?): CircuitBreaker` — shared registry (same id → same instance)
- `resetBreakers(): void` — test seam

### tests/reliability/breaker.test.ts
All 4 tests from brief (verbatim):
1. `opens after threshold consecutive failures`
2. `half-opens after cooldown and closes on a successful probe`
3. `a success resets the consecutive-failure count`
4. `breakerFor registry: returns the same breaker for the same id`

## TDD evidence

**RED** (before src/reliability/breaker.ts existed):
```
$ bun test tests/reliability/breaker.test.ts
error: Cannot find module '../../src/reliability/breaker.ts'
 0 pass
 1 fail
 1 error
```

**GREEN** (after implementing breaker.ts):
```
$ bun test tests/reliability/breaker.test.ts
 4 pass
 0 fail
 8 expect() calls
Ran 4 tests across 1 file. [13.00ms]
```

**Typecheck** (clean):
```
$ bun run typecheck
$ tsc --noEmit
(no output = success)
```

**Lint** (with --fix applied, then verified clean):
```
$ bun run lint:file -- --fix src/reliability/breaker.ts tests/reliability/breaker.test.ts
Fixed 2 files. (import grouping, line breaks)

$ bun run lint:file -- src/reliability/breaker.ts tests/reliability/breaker.test.ts
Checked 2 files in 4ms. No fixes applied.
```

## Files touched

- `src/reliability/breaker.ts` (new, 105 lines)
- `tests/reliability/breaker.test.ts` (new, 41 lines)

## Deviations from the brief

**Mandatory deviation (project convention):** enum BreakerState uses string values:
```ts
export enum BreakerState {
  Closed = 'Closed',
  Open = 'Open',
  HalfOpen = 'HalfOpen',
}
```
(vs. numeric enum in brief). All test comparisons (e.g., `toBe(BreakerState.Open)`) work unchanged. Required per root CLAUDE.md: "prefer enum over string literal unions for finite sets of named values (string enums only)".

**Formatting:** `biome check --fix` reformatted imports and multi-line argument lists (line breaks, trailing commas); no logic/behavior change from brief's code.

## Self-review

- State machine logic correctly implements the three-state FSM (Closed → Open → HalfOpen → Closed).
- Consecutive-failure count resets on any success in Closed state; success in HalfOpen increments probe counter instead.
- Cooldown checked **lazily** in `state()` (no timers) — matches brief's design.
- `run()` throws `CircuitOpenError(id)` when state is Open — correct.
- Shared registry uses Map; same id always returns the same breaker instance; `resetBreakers()` clears the registry.
- No `console.log`, early returns, small focused file (~105 lines of implementation + comments).
- Uses config defaults (`breakerThreshold()`, etc.) with injectable opts overrides.
- All tests passing; typecheck clean; lint clean.

## Concerns

None blocking. Implementation follows brief precisely, with the required string-enum deviation applied.
