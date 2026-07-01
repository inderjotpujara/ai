# Task 6 report — `runCrew` dispatcher + `onBeforeDelegate` threading, Slice 11

Note: there is an earlier `task-6-report.md` from Slice 10 ("workflow/DAG
executor, `engine.ts`") at this exact path from a prior slice's Task 6. This
report **overwrites** it per the current brief's explicit instruction to write
to `.superpowers/sdd/task-6-report.md`. Flagging in case the Slice-10 content
was still wanted for reference (it remains in git history at commit prior to
`6cff656`).

## What was implemented

1. **`src/workflow/run-step.ts`** — `defaultRunAgentStep` now accepts an
   optional second parameter `onBeforeDelegate?: BeforeDelegate` and passes it
   into `runGuardedAgent(agent, task, onBeforeDelegate)`. `BeforeDelegate` was
   added to the existing `import { runGuardedAgent } from '../core/delegate.ts'`
   line (now `import { type BeforeDelegate, runGuardedAgent } from '../core/delegate.ts'`).
   Diff is a 2-line signature/call change — fully backward compatible (existing
   callers that pass one argument get `onBeforeDelegate === undefined`, which
   `runGuardedAgent` already treats as "no hook").

2. **`src/crew/engine.ts`** (new) — exports:
   - `type CrewDeps` — `{ runAgentStep?, tools, maxParallel?, onBeforeDelegate? }`
   - `function crewAgentMap(crew, tools): Record<string, Agent>` — builds each
     member's `Agent` via `buildCrewAgent`, keyed by member name, using
     `member.tools ?? tools` as the fallback tool set.
   - `function runCrew(def, input, deps): Promise<CrewOutcome>` — wraps the
     whole dispatch in `withCrewSpan(def.id, def.process, …)`:
     - **Sequential** (`CrewProcess.Sequential`): `compileToWorkflow(def)` →
       `runWorkflow(wf, input, { runAgentStep, tools, maxParallel })` where
       `runAgentStep` defaults to
       `defaultRunAgentStep(crewAgentMap(def, deps.tools), deps.onBeforeDelegate)`
       unless the caller supplies its own (used by the tests to stub agent
       execution). Maps `WorkflowOutcome` → `CrewOutcome`:
       `{kind:'done', output}` → `{kind:'done', output}`;
       `{kind:'failed', failedStep, message}` → `{kind:'failed', failedTask: failedStep, message}`.
     - **Hierarchical**: `buildHierarchicalOrchestrator(def, deps.onBeforeDelegate)`
       → `runOrchestrator(orch, task)` where `task` is the crew input plus a
       fixed instruction to delegate to complete the crew's tasks. Maps
       `OrchestratorResult` → `CrewOutcome`: `{kind:'answer', text}` →
       `{kind:'done', output: text}`; anything else (`gap`/`resource`) →
       `{kind:'failed', message}`.

   Implemented verbatim from the brief's Step 3 code block (confirmed against
   the actual current signatures of every consumed interface before writing —
   `CrewOutcome`, `WorkflowOutcome`, `BeforeDelegate`, `Agent`, `runOrchestrator`,
   `withCrewSpan` — all matched exactly, no adjustments needed).

## TDD evidence

**RED (`tests/crew/engine.test.ts`, before `src/crew/engine.ts` existed):**
```
error: Cannot find module '../../src/crew/engine.ts' from '/Users/inderjotsingh/ai/tests/crew/engine.test.ts'
0 pass / 1 fail / 1 error
```

**RED (`tests/workflow/run-step.test.ts`, new `defaultRunAgentStep` hook-threading
assertion added before the `run-step.ts` source change):**
```
expect(seen).toEqual(['web_fetch'])
- [ "web_fetch" ]
+ []
5 pass / 1 fail   (the 5 pre-existing tests already passed; only the new one failed)
```

**GREEN (after both source changes):**
```
bun test tests/crew/engine.test.ts tests/workflow/run-step.test.ts
8 pass / 0 fail / 12 expect() calls
```

## Run-step regression evidence

The pre-existing 5 tests in `tests/workflow/run-step.test.ts` (agent step,
tool step, branch step, map step, `DEFAULT_MAX_PARALLEL` check) all pass
unchanged after the `defaultRunAgentStep` signature change — proving the
optional parameter is additive and doesn't alter behavior for callers that
don't pass it. One new test (`defaultRunAgentStep > threads onBeforeDelegate
into the guarded agent run`) was added: it builds a real `Agent` backed by
`MockLanguageModelV3` (same pattern as `tests/core/delegate.test.ts`), passes
a spy `onBeforeDelegate` that records the agent name, calls
`defaultRunAgentStep({web_fetch: agent}, spy)('web_fetch', 'do it')`, and
asserts both the returned text (`'done'`) and that the spy recorded
`['web_fetch']` — proving the hook reaches `runGuardedAgent` end-to-end
through the default implementation, not just at the type level.

## Verification run (in order)

```
bun test tests/crew/engine.test.ts tests/workflow/run-step.test.ts   → 8 pass, 0 fail
bun run typecheck                                                     → clean
bun run lint:file -- "src/crew/engine.ts" "src/workflow/run-step.ts"  → clean (0 errors after biome --write
                                                                          auto-fixed import order/formatting
                                                                          in engine.ts and engine.test.ts)
bun test (full suite)                                                 → 216 pass, 15 skip, 0 fail (231 total, 74 files)
bun run docs:check                                                    → passes (also re-ran automatically via pre-commit hook)
```

`bun run lint` (whole-repo) was also run once to double check: it reports 4
pre-existing errors in `tests/telemetry/crew-spans.test.ts` and
`tests/crew/member-agent.test.ts` (import-sort / object-shorthand issues).
Confirmed via `git status --porcelain` that neither file is touched by this
task's diff — they predate Task 6 and are Task 3/4's lint debt, out of this
task's scope. `lint:file` scoped to the two files this task actually changed
is clean.

## Files changed

- `src/workflow/run-step.ts` — modified (2-line diff: import + signature/call).
- `tests/workflow/run-step.test.ts` — modified (added `MockLanguageModelV3`
  import, `Agent`/`defaultRunAgentStep` imports, and one new `describe` block
  with the hook-threading test).
- `src/crew/engine.ts` — new.
- `tests/crew/engine.test.ts` — new.
- `docs/architecture.md` — modified. See "Docs audit" below.

## Docs audit (hard-line requirement)

`bun run docs:check` passed even before I touched `architecture.md` (the
`src/crew` subsystem was already present in the module table from Task 1). But
the *truth* of the existing crew section had drifted: it was written before
Tasks 2–6 landed and speculatively named a `runner.ts · roleDispatch` module
that was never built — the actual role-dispatch/compile responsibility ended
up split across `member-agent.ts` (`buildCrewAgent`) and `compile.ts`
(`compileToWorkflow` / `buildHierarchicalOrchestrator`), both already shipped
in Tasks 2 and 5 but never reflected in the diagram. I:

- Replaced the `CREW` subgraph's 3 speculative nodes with the 5 real files
  (`types.ts`, `define.ts`, `member-agent.ts`, `compile.ts`, `engine.ts`).
- Rewired the edges to match actual imports: `engine.ts → compile.ts`,
  `compile.ts → member-agent.ts`, `compile.ts → workflow/define.ts`,
  `member-agent.ts → resource/selector.ts` (indirectly, via the model-req
  fields the selector later reads), `engine.ts → workflow/engine.ts`,
  `engine.ts → core/orchestrator.ts`, `engine.ts → telemetry/spans.ts`,
  `define.ts → types.ts`, `types.ts → workflow/types.ts`.
- Rewrote the "Crew / Roles" table row to describe what each file now does
  and its real "knows about" dependencies (dropped the direct
  `core/delegate.ts` edge from `engine.ts` — the actual delegate touchpoint is
  one level down, inside `workflow/engine.ts`'s `defaultRunAgentStep` and
  inside `core/orchestrator.ts`'s `asDelegateTool`).
- Re-ran `docs:check` after the edit (still passes; also passed again inside
  the pre-commit hook).

## Self-review

- Compared every import in `src/crew/engine.ts` against the real current
  export of each source file before finalizing (not just against the brief's
  code, since the brief could itself be stale) — `CrewOutcome`, `CrewProcess`,
  `CrewDef` (`types.ts`); `compileToWorkflow`, `buildHierarchicalOrchestrator`
  (`compile.ts`); `buildCrewAgent` (`member-agent.ts`); `withCrewSpan`
  (`telemetry/spans.ts`); `runWorkflow`, `WorkflowDeps`, `defaultRunAgentStep`
  (`workflow/engine.ts`, which re-exports from `run-step.ts`); `runOrchestrator`
  (`core/orchestrator.ts`); `BeforeDelegate` (`core/delegate.ts`); `Agent`
  (`core/agent-def.ts`). All matched; no adjustments were needed to the
  brief's code.
- Confirmed `WorkflowOutcome`'s failed-branch field is literally named
  `failedStep` (in `src/workflow/types.ts`), matching the `failedTask:
  outcome.failedStep` rename in the `CrewOutcome` mapping.
- Confirmed no `console.*` calls were introduced in either changed file
  (`grep` clean).
- Ran `biome check --write` once (not by hand) to fix import ordering /
  object-multiline formatting bike-shedding in `engine.ts` and
  `engine.test.ts` — content/logic untouched, confirmed by re-running the
  targeted tests + typecheck immediately after and diffing the change against
  what I'd just written (only whitespace/import order moved).

## Concerns (residual, not blocking)

1. **"Never throws into the caller" is true for the sequential path but not
   airtight for the hierarchical path.** `withCrewSpan` (via the shared
   `inSpan` helper in `telemetry/spans.ts`) re-throws after recording span
   status — it does not swallow errors. `runWorkflow` itself is verified
   (by the Slice-10 Task 6 report and its own tests) to never throw — all
   step failures become a `{kind:'failed', ...}` return value — so the
   sequential branch of `runCrew` is safe end-to-end. `runOrchestrator`,
   however, has one uncaught path: if the delegated run throws something that
   is neither a `MaxStepsError` with a resolvable capability gap nor
   accompanied by a `capture?.error`, it re-throws at
   `src/core/orchestrator.ts:100`. That throw would propagate through
   `buildHierarchicalOrchestrator`'s caller, through `withCrewSpan`, and out
   of `runCrew` for hierarchical crews. This mirrors the *existing* pattern in
   `src/cli/run-chat.ts` (which also calls `runOrchestrator` with no
   surrounding try/catch), so it's a pre-existing, accepted risk surface in
   the codebase rather than something this task introduced — but it means the
   task's "Engine must NEVER throw into the caller" constraint is only fully
   satisfied for `CrewProcess.Sequential`, not unconditionally for
   `CrewProcess.Hierarchical`. I implemented the brief's code verbatim as
   instructed rather than unilaterally adding a try/catch around
   `runOrchestrator` inside `runCrew`, since that would be a scope-expanding
   design decision (swallow-and-report vs. let it propagate) that seemed
   better flagged than silently decided. Happy to add a
   `try { ... } catch (e) { return {kind:'failed', message: (e as Error).message} }`
   wrapper around the hierarchical branch in a follow-up if the stricter
   reading of the constraint is intended.
2. The pre-existing whole-repo `bun run lint` debt (`tests/telemetry/crew-spans.test.ts`,
   `tests/crew/member-agent.test.ts`) is unrelated to this task but will show
   up again on the next `bun run check` gate; worth a quick cleanup pass
   before the Slice-11 final review.
