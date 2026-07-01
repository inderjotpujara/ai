# Final Review Fix Report — Slice 3 MCP Integration

## Summary

Both fixes applied on branch `slice-3-mcp-integration`. All tests pass; typecheck clean; lint 0 errors (1 pre-existing biome.json deprecation notice, acceptable). Commit: `3a2dc26 refactor(cli): close each MCP server on all paths; drop unused test imports`.

---

## FIX 1 — chat.ts mount lifecycle (nested try/finally)

**File changed:** `src/cli/chat.ts`

Restructured the mount+try+finally section so `fileServer` is moved before the outer `try`. `fetchServer` is now created inside the outer `try` with its own inner `try/finally` that closes it. `fileServer.close()` and `unloadModel()` remain in the outer `finally`. Result: if `createFetchTools()` rejects, the outer `finally` still closes `fileServer` and unloads the model. No `!` assertions introduced; no other logic changed.

---

## FIX 2 — Drop unused imports in mount.test.ts

**File changed:** `tests/mcp/mount.test.ts`

Removed `afterEach` and `beforeEach` from the `bun:test` import line. Neither was referenced in the file; biome lint would flag unused imports.

---

## Typecheck / Lint / Test

```
typecheck: tsc --noEmit → 0 errors (no output)
lint:      biome check . → Found 1 info (pre-existing biome.json deprecation), 0 errors
test:      bun test → 44 pass, 5 skip, 0 fail (49 tests across 24 files, 3.43s)
```

---

## Concerns

None. Changes are minimal and mechanical. The biome formatter required the `createSuperAgent(...)` call to be broken onto three lines at the new indentation depth — applied alongside the structural change.

---

# Final Review Fix Report — Slice 2 Orchestrator

## Summary

All 5 fixes applied on branch `slice-2-orchestrator`. All tests pass; typecheck clean; lint 0 errors (1 pre-existing biome.json deprecation notice, acceptable).

---

## FIX 1 — Correctness: capability-gap signal no longer lost to MaxStepsError

**Files changed:**
- `src/core/errors.ts`: Added `readonly steps: unknown[]` field to `MaxStepsError` with optional constructor arg (`steps: unknown[] = []`). Backward compatible — existing `new MaxStepsError(msg)` still works.
- `src/core/agent.ts`: Changed throw to `throw new MaxStepsError(msg, steps)` passing the accumulated steps.
- `src/core/orchestrator.ts`: Wrapped `runDefinedAgent` call in try/catch. On `MaxStepsError`, calls `findCapabilityGap(err.steps as Parameters<typeof findCapabilityGap>[0])`; if gap found, returns `{ kind:'gap', ... }`; otherwise rethrows.

**TDD evidence:** Added test `'gap detected from MaxStepsError: orchestrator resolves kind:gap when runAgent throws after report_capability_gap'` in `tests/core/orchestrator.test.ts`. The mock model always returns `report_capability_gap` tool-call, never producing text — hits the 10-step ceiling, `runAgent` throws `MaxStepsError`, orchestrator must catch and resolve. Test passes confirming the fix path is exercised.

---

## FIX 2 — Document gap-wins precedence

**File changed:** `src/core/orchestrator.ts`

Added two comments in `runOrchestrator`:
1. In the catch block (MaxStepsError path): explains gap takes precedence regardless of delegate output or final text.
2. On the normal path after `runDefinedAgent` succeeds: same rule documented for the non-throw path.

No behavior change.

---

## FIX 3 — Remove dead DelegationError (YAGNI)

**Files changed:**
- `src/core/errors.ts`: Removed `DelegationError` class declaration.
- `tests/core/errors.test.ts`: Removed `DelegationError` import and its test case.

`asDelegateTool` in `delegate.ts` intentionally returns `{ error }` rather than throwing, so `DelegationError` was never used.

---

## FIX 4 — Routing prompt lists concrete tool names

**File changed:** `src/core/orchestrator.ts` `buildRoutingPrompt`

Changed catalog line from `- ${a.name}: ${a.description}` to `- ${delegateToolName(a)}: ${a.description}` (e.g. `delegate_to_file_qa: handles file_qa tasks`). Small local models get the exact tool name to call, reducing routing errors. Orchestrator tests use mock models and do not assert prompt text — all pass unchanged.

---

## FIX 5 — Answer-path test for run-chat

**File changed:** `tests/cli/run-chat.test.ts`

Added `answerOrchestrator()` factory (mock model returns `finishReason:'stop'` with non-empty text, no tool calls) and test `'runChat records an answer run and writes the answer artifact'`. Asserts:
- `result.kind === 'answer'`
- `result.text === 'Here is your answer.'`
- `answer.txt` written with that text
- Journal steps `['start', 'answer']`

---

## Test / Typecheck / Lint / Full-Suite Outputs

### Targeted test files

```
bun test ./tests/core/errors.test.ts       -> 2 pass, 0 fail
bun test ./tests/core/agent.test.ts        -> 2 pass, 0 fail
bun test ./tests/core/orchestrator.test.ts -> 4 pass, 0 fail
bun test ./tests/cli/run-chat.test.ts      -> 2 pass, 0 fail
```

### Typecheck

```
$ tsc --noEmit
(no output — 0 errors)
```

### Lint

```
$ biome check .
biome.json:6:13 deserialize  DEPRECATED  (pre-existing info notice — acceptable)
Checked 46 files in 31ms. No fixes applied.
Found 1 info.   <- 0 errors
```

### Full suite

```
$ bun test
40 pass, 3 skip, 0 fail
74 expect() calls
Ran 43 tests across 20 files. [233ms]
```

---

## Self-Review

- No `!` non-null assertions introduced anywhere.
- No new `interface` (used `type` alias for implicit types).
- `errors.ts` has no `ai` import — `steps` typed as `unknown[]` as specified.
- Cast `err.steps as Parameters<typeof findCapabilityGap>[0]` is contained to orchestrator; capability-gap.ts unchanged.
- FIX 1 throw path confirmed by the new orchestrator test which would fail without the catch block.
- FIX 5 answer path confirmed by the new run-chat test.
- Biome deprecation notice is pre-existing (in `biome.json:6`) and was present before any changes.

---

## Concerns

None. All fixes are minimal and targeted. The `MaxStepsError` steps payload cast is the only type compromise; it is isolated to a single expression in orchestrator.ts and matches the existing `Parameters<typeof findCapabilityGap>[0]` pattern.
