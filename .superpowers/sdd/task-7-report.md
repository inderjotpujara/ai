# Task 7 Report: Deliver load-time context to managed runtimes in `select-hook.ts`

## Status
✅ COMPLETE

## Implementation Summary
In `createSelectHook`'s returned hook (`src/cli/select-hook.ts`), added a warm
call for managed (non-Ollama) runtimes, placed after the availability/degrade
block resolves `rt` + `effectiveDecl` (i.e. strictly after any degrade-to-Ollama
reassignment of `rt`) and before `recordModelSelect`/`createModel`:

```typescript
if (rt.kind !== RuntimeKind.Ollama) {
  await rt.control.warm(effectiveDecl.model, numCtx);
}
```

Ollama already warms via `ensureReady` inside `resolveModel`, so it is
deliberately excluded here. The existing per-call
`numCtx: rt.kind === RuntimeKind.Ollama ? numCtx : undefined` line was left
unchanged — managed runtimes apply context at load time via `control.warm`,
not per call.

## TDD sequence
1. Added two real tests to `tests/cli/select-hook.test.ts` using the existing
   `SelectHookDeps.runtimeFor` injection harness (no placeholder `expect(true)`):
   - `select-hook warms a managed (non-Ollama) runtime with the resolved context`
     — a `LlamaCpp`-kind fake runtime whose `control.warm` records
     `[model, numCtx]` into a `warmed` array; registry has one `LlamaCpp` decl
     (`llamaCppDecl`); `ensureReady` resolves to ctx `8192`. Asserts
     `warmed).toEqual([[llamaCppDecl.model, 8192]])`.
   - `select-hook does NOT warm the managed runtime when degraded to Ollama`
     — same `llamaCppDecl`, but `runtimeFor` reports only Ollama as reachable,
     forcing the existing Slice-21 degrade path. Asserts `log` was called
     once (degrade happened) **and** `warmed` stays `[]`.
2. Ran `bun test tests/cli/select-hook.test.ts` before implementing: the new
   "warms a managed runtime" test failed as expected (`warmed` was `[]`
   instead of `[[model, 8192]]`); confirmed red.
3. Implemented the 3-line guard exactly where the brief specified.
4. Reran: all 8 tests in the file pass — the two new warm tests plus the
   3 pre-existing Slice-21 MLX/degrade/fallbackModel tests, unaffected.

## Confirmation — degraded-to-Ollama path does NOT call managed warm
Verified explicitly by the second new test. When the declared `LlamaCpp`
runtime is reported unreachable, `rt` is reassigned to the Ollama fake runtime
*before* the new warm block runs (the block sits after the reassignment in
source order), so `rt.kind !== RuntimeKind.Ollama` evaluates false and
`control.warm` is skipped entirely — `warmed` stays `[]`. Ollama's own
warming continues to happen earlier, inside `resolveModel`'s `ensureReady`
call, which this change does not touch.

## Commits
- **6477382** `feat(runtime): deliver load-time context to managed runtimes in select-hook`

## Test Summary
`bun test tests/cli/select-hook.test.ts` → 8 pass, 0 fail, 22 expect() calls
(2 new warm tests + 6 pre-existing tests, all green).

## Linting & Typecheck
- ✅ `bun run typecheck` — passed, no errors
- ✅ `bun run lint:file src/cli/select-hook.ts tests/cli/select-hook.test.ts` — "Checked 2 files ... No fixes applied."
- ✅ Pre-commit hook (docs-check) — passed

## Files touched
- `/Users/inderjotsingh/ai/src/cli/select-hook.ts` (+7 lines)
- `/Users/inderjotsingh/ai/tests/cli/select-hook.test.ts` (+71 lines: two new
  tests + a `llamaCppDecl` fixture + a `warmRecordingRuntime` fake-runtime
  helper)

## Concerns
None. The `warm` signature already existed on `Runtime.control` in the
pre-existing fake-runtime helpers in this test file (all stubbed as
`async () => {}`), so no upstream interface changes were needed — this task
was purely wiring the existing capability into the hook's control flow.

---
**Created:** 2026-07-05
**Report path:** `/Users/inderjotsingh/ai/.superpowers/sdd/task-7-report.md`
