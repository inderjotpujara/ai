### Task 8 report: Runtime telemetry (`RUNTIME_*` attrs + `withRuntimeSpan`)

**Status:** DONE

**Commit:** `25c22da` — `feat(telemetry): runtime warm/spawn spans + RUNTIME_* attrs`

**What changed**

1. `src/telemetry/spans.ts`
   - Added five `ATTR` keys: `RUNTIME_KIND`, `RUNTIME_CONTEXT_CAPABILITY`, `RUNTIME_CONTEXT_REQUESTED`, `RUNTIME_CONTEXT_APPLIED`, `RUNTIME_WARM_OUTCOME`.
   - Added `withRuntimeSpan<T>(kind: RuntimeKind, fn)` mirroring `withCrewBuildSpan`'s recorder shape: opens a `runtime.warm` span, sets `RUNTIME_KIND` immediately, and hands the body a recorder `{ applied(requestedCtx, appliedCtx, outcome, capability) }`. `requestedCtx`/`appliedCtx` are only set when not `undefined` (same "omit rather than sentinel" convention as the rest of the file), so a `fixed`-capability runtime's applied-ctx attribute is absent rather than misleadingly equal to the request.
   - `import type { RuntimeKind } from '../core/types.ts'` added (type-only, no cycle risk).

2. `src/runtime/managed-openai-compatible.ts`
   - `doWarm` body now runs inside `withRuntimeSpan(strategy.kind, ...)`. All four exit paths record via `rec.applied(...)`:
     - early-return same-(model,ctx) → `'reused'`
     - `daemonLoad` success → `'daemon-loaded'`
     - `launch`/`superviseServer` success → `'spawned'`
     - any thrown error (missing launch/daemonLoad, daemonLoad throws, launch throws, superviseServer throws) → `'failed'`, then rethrown unchanged.
   - `appliedCtx` = `ctx` for `relaunch`/`reload`, `undefined` for `fixed` (MLX) — matches the brief's "omit for fixed" instruction (chose omit over `-1` since the recorder already treats `undefined` as "don't set").
   - `requestedCtx` = the raw `numCtx` param `warm`/`doWarm` was called with (before `effectiveCtx` nulls it for `fixed`), so the caller's intent is visible even when the runtime can't honor it.
   - `control.warm`'s outer `breaker.run(() => doWarm(model, numCtx))` wrapping is untouched — span is inside the breaker, so a breaker-open short-circuit (rare, doesn't call `fn`) doesn't spuriously emit a span, while every attempt that *does* run always ends its span (even on throw, since `withRuntimeSpan`/`inSpan` always calls `span.end()` in a `finally`).
   - `warm`'s external signature/return (`Promise<void>`) and behavior are unchanged.

**Tests**

- New `tests/telemetry/runtime-span.test.ts` (6 tests): brief's literal test, ATTR-key assertions, real span-emission checks via `registerTestProvider`/`InMemorySpanExporter` for the happy path, the fixed-capability omission, and error propagation + span-still-ends.
- Extended `tests/runtime/managed-openai-compatible.test.ts` with a `describe('runtime.warm telemetry (Slice 26 Task 8)')` block (4 tests): spawned→reused sequencing on repeated same-(model,ctx) warm, `daemon-loaded` outcome for daemon strategies, `RUNTIME_CONTEXT_APPLIED` omission for `fixed` (MLX), and `failed` outcome + error propagation when `launch` throws.
- Verified TDD ordering by running the new/extended `managed-openai-compatible.test.ts` telemetry block against the pre-wiring source — 4 failures (span count 0 vs expected), confirming the tests exercise the new wiring and aren't no-ops. The `spans.ts`-only tests (`withRuntimeSpan` itself) were written and implemented together since they're a pure new-function addition with no separate existing-code path to redden first.

**Commands run**

- `bun test tests/telemetry/runtime-span.test.ts tests/runtime/managed-openai-compatible.test.ts` → 21 pass, 0 fail.
- `bun test tests/telemetry/ tests/runtime/` (full directories) → 73 pass, 0 fail (no regressions in sibling telemetry/runtime tests).
- `bun run typecheck` → clean.
- `bun run lint:file src/telemetry/spans.ts src/runtime/managed-openai-compatible.ts tests/telemetry/runtime-span.test.ts tests/runtime/managed-openai-compatible.test.ts` → clean (fixed two `noUnusedFunctionParameters` warnings + one formatter diff in the test file along the way).
- `bun run docs:check` (ran automatically via pre-commit) → passes — no new subsystem; `telemetry`/`runtime` were already documented in `docs/architecture.md`, and per-task commits on a slice branch don't carry the architecture.md gate (that's the push-to-main/slice-landing gate).

**Self-review notes**

- Considered whether the span should wrap `breaker.run(...)` instead of sitting inside `doWarm`. Chose inside-`doWarm` (breaker still wraps the whole span) because: (a) the brief said "inside or around it consistently," (b) this way a `CircuitOpenError` short-circuit before `fn` even runs correctly produces *no* span (nothing was attempted), which is more honest telemetry than emitting a phantom `runtime.warm` span for an attempt that never happened.
- Considered `-1` vs omit for the fixed-capability applied-ctx per the brief's "`-1`/omitted" phrasing — went with omit since it composes with the recorder's existing `if (x !== undefined)` pattern used by every other span helper in this file, and OTel attribute absence is a more idiomatic "not applicable" signal than a magic sentinel.

**Concerns:** none. No follow-ups identified.
