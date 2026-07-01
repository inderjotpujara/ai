# Task 12 report: wire memory into crews + workflows

## Summary

Wired the memory layer (Tasks 4/9/10) into the workflow and crew engines as two
strictly optional, additive integrations. When `memory` is absent from deps,
behavior is byte-for-byte identical to before this change — verified by running
the full existing crew/workflow suites unchanged and green.

## TDD: RED -> GREEN

1. Wrote `tests/memory/wiring.test.ts` (5 cases, expanded beyond the brief's 2):
   persist-true writes namespaced (asserts `namespace`, `space`, `kind`,
   `source`, and text payload), persist-false skips, no-store skips,
   empty/whitespace output skips, non-string output gets `JSON.stringify`'d.
2. Ran `bun test tests/memory/wiring.test.ts` -> **FAIL**:
   `SyntaxError: Export named 'autoPersistStepOutput' not found in module
   '.../src/workflow/run-step.ts'.` (RED confirmed.)
3. Implemented `autoPersistStepOutput` in `src/workflow/run-step.ts` per the
   brief's exact shape (space=`default`, kind=`MemoryKind.RunMemory`,
   source=`${workflowId}:${stepId}`).
4. Reran -> **5 pass, 0 fail** (GREEN).

## Implementation

**`src/workflow/run-step.ts`**
- Added `autoPersistStepOutput(store, info)`: no-op if `!store || !persist`;
  stringifies non-string output; skips empty/whitespace text; calls
  `store.remember(text, { space: 'default', namespace: workflowId, kind:
  MemoryKind.RunMemory, source: \`${workflowId}:${stepId}\`, at })`.
- Extended `WorkflowDeps` with optional `memory?: MemoryStore` and
  `persistMemory?: boolean` (engine-wide default, true when omitted).

**`src/workflow/types.ts`**
- Added `persistMemory?: boolean` to `StepBase<O>` (inherited by all step
  kinds) so an individual step can opt out even when the engine-level default
  is on.

**`src/workflow/engine.ts`**
- After a step's raw output passes `output.safeParse` (i.e. "completes +
  validates"), and only when `deps.memory` is set, calls
  `autoPersistStepOutput(deps.memory, { workflowId: def.id, stepId: step.id,
  output: parsed.data, persist: step.persistMemory ?? deps.persistMemory ??
  true, at: Date.now() })`. Placed before the `{ step, value }` result is
  returned, inside the existing try/catch so a memory-write failure surfaces
  through the step's normal `onError` policy rather than crashing the batch
  silently.

**`src/crew/types.ts`**
- Added `Task.persistMemory?: boolean` (per-task override) and
  `CrewDef.persistMemory?: boolean` (crew-wide default for sequential crews).

**`src/crew/compile.ts`**
- `compileToWorkflow` now threads `task.persistMemory` onto the compiled
  workflow step, so a task's own opt-out reaches the engine.

**`src/crew/engine.ts`**
- `CrewDeps` gained `memory?: MemoryStore` and `persistMemory?: boolean`.
- `crewAgentMap(crew, tools, memory?)` — when `memory` is present, builds one
  shared `recall` tool via `makeRecallTool(memory, { namespace: crew.id })`
  and merges it into every member's tool set (`{ ...(member.tools ?? tools),
  ...recallTools }`), so each member can call `recall` mid-run in addition to
  its own tools.
- `runCrew`'s sequential branch passes `deps.memory` into `crewAgentMap` and
  into `runWorkflow`'s deps (`memory: deps.memory, persistMemory:
  deps.persistMemory ?? def.persistMemory`), so auto-write fires downstream.
  Since `compileToWorkflow` sets the workflow id to the crew id
  (`defineWorkflow({ id: crew.id, ... })`), the auto-write namespace and the
  recall namespace are both `crew.id` — consistent, as called out in the brief.
- Hierarchical crews (the orchestrator path) were intentionally left
  untouched: they're a structurally different delegation mechanism not in the
  brief's scope, and touching them risked breaking `orchestrator`'s own
  contract for no requested benefit. Recall/auto-write is currently only wired
  for the sequential (workflow-backed) path.

## Live test

Added `tests/integration/memory.live.test.ts`:
- Mirrors `tests/integration/crew.live.test.ts`'s skip guard exactly:
  `const ready = await ollamaReady('qwen3-embedding:0.6b'); describe.skipIf(!ready)(...)`.
- Builds the real store the same way `src/cli/memory.ts`'s `makeRealStore`
  does: `createModelManager()` + `runtimeFor(ProviderKind.Ollama).control` +
  `makeEmbedder({ ensureReady, control, model })` + `probeEmbedder` +
  `createMemoryStore`.
- First asserts `probeEmbedder('qwen3-embedding:0.6b')` returns real numeric
  `dim > 0` and `maxInput > 0` — closes the Task 4 minor about the silent
  `{dim:768, maxInput:2048}` fallback going unverified.
- Remembers "The Raft consensus algorithm elects a leader via randomized
  election timeouts." then recalls "how does raft choose a leader"; asserts at
  least one hit comes back and the joined text matches `/leader|raft/i`.
- 180s timeout; cleans up `/tmp/mem-live` before and after; calls
  `store.close()` and `manager.unloadAll()` in a `finally`.
- **Result in this environment: SKIPPED** (Ollama unreachable at
  `localhost:11434` — confirmed via `ollamaReady` returning false). This is
  expected per the brief ("It's fine if it SKIPS in this environment"); the
  unit wiring test is the real gate and it passed.

## Verification run

- `bun test tests/memory/wiring.test.ts` -> 5 pass, 0 fail.
- `bun run typecheck` -> clean (`tsc --noEmit`, no output/errors).
- `bun test tests/crew tests/workflow tests/memory` -> 64 pass, 0 fail
  (confirms existing `crew/*.test.ts`, `workflow/*.test.ts` suites pass
  unchanged alongside the new memory wiring tests).
- `bun test` (full suite) -> **253 pass, 17 skip, 0 fail** across 270 tests /
  90 files (skips are all live/Ollama-gated tests, consistent with pre-task
  baseline).
- `bun run lint:file` on all 8 touched/added files -> clean after
  `biome check --write` fixed two cosmetic issues (import order in
  `wiring.test.ts`, one line-wrap in `memory.live.test.ts`).
- `bun run lint` (whole repo) -> pre-existing 6 errors/3 warnings/1 info
  unrelated to this task (in `tests/memory/recall-tool.test.ts` and
  `tests/memory/define.test.ts`, from earlier Task 9/10 work). Confirmed via
  `git stash` + rerun that these exist independent of this task's diff — not
  introduced here, and out of this task's scope to fix.

## Self-review

- Additive-only: `WorkflowDeps.memory`, `WorkflowDeps.persistMemory`,
  `StepBase.persistMemory`, `CrewDeps.memory`, `CrewDeps.persistMemory`,
  `CrewDef.persistMemory`, `Task.persistMemory` are all optional with safe
  defaults (`persist` defaults to `true` only when a store is actually
  supplied — when `memory` is absent nothing changes at all, since the whole
  block in `engine.ts` is gated on `if (deps.memory)`).
- Default-true when memory IS present matches the brief precisely
  ("Respect a `persistMemory` flag (default true) on the crew/task").
- Namespace consistency (crew id == workflow id) verified by reading
  `compile.ts`'s `defineWorkflow({ id: crew.id, ... })` rather than assuming it.
- Recall tool name `recall` could collide with a member's own custom tool
  named `recall`; current merge order (`...memberTools, ...recallTools`) has
  the memory-bound recall tool win that collision. This seems like the
  right default (the framework's memory recall should be authoritative) but
  is worth flagging — no existing crew defines a `recall` tool today, so no
  behavior changed in practice.
- Memory write failures inside `autoPersistStepOutput` propagate through the
  step's existing `try/catch` in the engine and are subject to the step's
  `onError` policy (fail/continue/fallback) — no new silent-failure path was
  introduced; a broken memory store during a run surfaces exactly like any
  other step-level error would.
- Did not touch `docs/architecture.md` — the memory section is explicitly
  marked "Stub — filled in as the slice lands (Task 14)" and this task's brief
  does not list docs as a deliverable; leaving that to Task 14 as scoped.

## Concerns

- None blocking. The one soft judgment call is leaving the hierarchical crew
  path (orchestrator-based) without recall/auto-write wiring — flagged above
  for visibility in case Slice 12's later tasks or the final slice review
  expect memory parity across both crew processes.
- Live test is unverified end-to-end in this environment (Ollama down) — its
  correctness rests on careful reading of `makeRealStore`/`probeEmbedder`
  signatures rather than an actual run. Recommend running it once on a machine
  with Ollama + `qwen3-embedding:0.6b` pulled before considering Slice 12 done.

## Files touched

- `/Users/inderjotsingh/ai/src/workflow/run-step.ts`
- `/Users/inderjotsingh/ai/src/workflow/engine.ts`
- `/Users/inderjotsingh/ai/src/workflow/types.ts`
- `/Users/inderjotsingh/ai/src/crew/engine.ts`
- `/Users/inderjotsingh/ai/src/crew/types.ts`
- `/Users/inderjotsingh/ai/src/crew/compile.ts`
- `/Users/inderjotsingh/ai/tests/memory/wiring.test.ts` (new)
- `/Users/inderjotsingh/ai/tests/integration/memory.live.test.ts` (new)

Commit: `e0748ad` — "feat(memory): wire recall + namespaced auto-write into
crews and workflows"
