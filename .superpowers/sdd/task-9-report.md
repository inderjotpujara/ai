# Task 9 report — raw-workflow opt-in verify wiring

## Was there anything distinct left to build?

Yes. Investigated whether crew compilation and raw `defineWorkflow` are the
same code path (in which case Task 8 would already cover this) — they are
**two separate authoring surfaces** that share only the runtime engine
(`runWorkflow`/`runStepByKind`, `StepKind.Verify`, `expandVerification`):

- **Crew path**: `CrewDef` (tasks/members) → `compileToWorkflow(crew, verifyOpts?)`
  (`src/crew/compile.ts`) builds a `WorkflowDef`, splicing `expandVerification(...)`
  after any task with `task.verify ?? crew.verify`. `runCrew` (`src/crew/engine.ts`)
  then calls `runWorkflow`, and **separately** scans `outcome.output` for an
  `UnverifiedMarker` via its own `findUnverified` helper, mapping it to
  `CrewOutcome {kind:'unverified'}`.
- **Raw workflow path**: authors call `defineWorkflow(def)` directly with a
  hand-built `Step[]` (no `CrewDef`, no tasks/members) and run it via
  `runWorkflow` (`src/workflow/engine.ts`), consumed directly by
  `src/cli/flow.ts`. Before this task, `defineWorkflow` only validated the step
  graph (unique ids, resolvable deps, acyclic) — it had **no** verify-splicing,
  `AgentStep` had **no** `verify` field, and `WorkflowOutcome` had **no**
  `unverified` variant. `runWorkflow` returned only `done`/`failed`.

So nothing was redundant to build: raw workflow authors had no opt-in path at
all. `expandVerification` itself (the sub-graph) and `StepKind.Verify`
dispatch in `run-step.ts` were already fully engine-level/generic from Task 8
and are reused verbatim, unmodified.

This is confirmed by the Task 8 commit message itself: "Shared
expandVerification() helper (src/verification/expand.ts) so the workflow path
(Task 9) reuses the exact sub-graph" — Task 8's author explicitly deferred
this wiring to Task 9.

## What was wired

1. **`src/workflow/types.ts`**
   - `AgentStep.verify?: boolean` — opt-in flag, mirrors `Task.verify` in
     `src/crew/types.ts`.
   - `WorkflowOutcome` gained a third variant:
     `{ kind: 'unverified'; failedStepId?: string; unsupportedClaims: string[]; faithfulness: number; draft: string }`,
     mirroring `CrewOutcome`'s `unverified` variant field-for-field (renamed
     `failedTaskId` → `failedStepId` since this is step-, not task-, scoped).

2. **`src/workflow/define.ts`**
   - New exported type `DefineVerifyOpts` (verifyDeps/space/maxRetries/threshold),
     the workflow-level mirror of `CompileVerifyOpts` in `src/crew/compile.ts`.
   - `defineWorkflow(def, verifyOpts?)` — new optional second parameter. When
     supplied, a new `expandVerifiedSteps` helper walks `def.steps` and splices
     `expandVerification({...})` (imported verbatim from
     `src/verification/expand.ts`, zero duplication) immediately after any
     `StepKind.Agent` step with `verify: true`. The existing validation logic
     (unique ids, resolvable deps, branch targets, acyclic check) now runs over
     the expanded step list, for free — the same DAG guarantees crew-compiled
     verify sub-graphs get.
   - When `verifyOpts` is omitted, `defineWorkflow` is byte-for-byte the
     original function (same steps array, same validation, same return).

3. **`src/workflow/engine.ts`**
   - New internal `findUnverified(ctx)` helper — mirrors
     `findUnverified(output)` in `src/crew/engine.ts` exactly (scans context
     values for `isUnverifiedMarker`).
   - `runWorkflow`, on reaching its final `{kind:'done'}` return, now scans the
     finished context first; if an `UnverifiedMarker` is present it returns
     `{kind:'unverified', ...}` instead. No behavior change when no marker is
     present (which is always true unless a `verify:true` step's sub-graph ran
     and hit its abstain terminal).

4. **`src/crew/engine.ts`** (consumer fix, not new wiring)
   - Because `runWorkflow` can now itself return `{kind:'unverified'}`,
     `runCrew`'s existing `if (outcome.kind === 'done') { ...findUnverified... }`
     branch needed a sibling `else if (outcome.kind === 'unverified')` to stay
     total (TypeScript's discriminated-union narrowing caught this — the old
     `else` implicitly assumed `failed`, and `tsc --noEmit` failed on
     `outcome.failedStep`/`outcome.message` not existing on the widened union).
     Crews still primarily detect unverified via their own compile-time splice
     + `findUnverified` on `outcome.output` (unchanged); this new branch only
     fires if a crew's `runWorkflow` call is ever given verify-expanded steps
     directly outside `compileToWorkflow`'s own splice, which doesn't happen
     today — added purely so the union stays exhaustively handled.

5. **`src/cli/flow.ts`** (consumer update, mirrors `src/cli/crew.ts`)
   - `runFlow`: added an `unverified` branch that writes `unverified.txt`
     (mirrors `runCrewCli`'s `unverified.txt` artifact).
   - `main()`: added an `unverified` branch printing an abstain message and
     setting `process.exitCode = 1` (mirrors the crew CLI's console message).

## Backward-compat evidence

- `defineWorkflow(def)` (no second arg) — new test
  `no verifyOpts at all → defineWorkflow output identical to before` passes;
  `def.steps.length` stays 1, no verify machinery runs.
- `defineWorkflow(def, verifyOpts)` where the step lacks `verify: true` — new
  test `no verify flag → unchanged` passes; asserts `def.steps.length` stays 1
  (no splice) and that the injected fake judge's `generate` is **never called**
  (`generateCalls` stays 0) — i.e. verifyDeps is provably inert for a
  non-opted-in step, exactly the crew path's precedent
  (`tests/crew/verify-wiring.test.ts` asserts the same thing for
  `CrewDeps.verifyDeps`).
- Full existing suites stayed green with no test changes needed:
  `tests/workflow/` (21 pass) and `tests/crew/` (20 pass) — Task 8's crew
  verify tests (`tests/crew/verify-wiring.test.ts`, 4 tests) and all pre-Slice-13
  workflow tests pass unmodified.
- `AgentStep.verify` is optional and `WorkflowOutcome`'s new member is additive
  to the union — `tsc --noEmit` caught the two call sites that needed updating
  for exhaustiveness (`src/crew/engine.ts`, `src/cli/flow.ts`, both fixed
  above); no other call site existed anywhere in `src/`.

## TDD RED/GREEN evidence

- RED: wrote `tests/workflow/verify-wiring.test.ts` against the *target* API
  (`defineWorkflow(def, verifyOpts)`, `WorkflowOutcome.kind === 'unverified'`)
  before touching any `src/` file. First run:
  ```
  Expected: "unverified"
  Received: "done"
  (fail) workflow verify wiring > verify:true + failing judge → outcome surfaces unverified
  2 pass / 1 fail
  ```
  (2 pass because those two other cases happened to match pre-wiring behavior
  trivially — e.g. the "no verify flag" case was already a plain `done`; the
  failing-judge assertion on `outcome.kind === 'unverified'` is what caught
  the missing wiring.)
- GREEN after implementing `types.ts` + `define.ts` + `engine.ts`:
  ```
  4 pass / 0 fail / 14 expect() calls
  Ran 4 tests across 1 file.
  ```

## Verification gate — all green, in order

1. `bun run typecheck` — clean (after fixing the two exhaustiveness call
   sites it flagged: `src/crew/engine.ts`, `src/cli/flow.ts`).
2. `bun run lint:file -- "src/workflow/types.ts" "src/workflow/define.ts" "src/workflow/engine.ts" "src/crew/engine.ts" "src/cli/flow.ts" "tests/workflow/verify-wiring.test.ts"` —
   clean after one `biome check --write` pass for import-sort/line-wrap
   formatting only (no logic changes).
3. `bun test tests/workflow/verify-wiring.test.ts` — 4 pass / 0 fail.
4. `bun test tests/workflow/` — 21 pass / 0 fail. `bun test tests/crew/` — 20
   pass / 0 fail.
5. `bun run test` (full suite) — **280 pass, 18 skip (pre-existing), 0 fail,
   577 expect() calls, 298 tests across 100 files**.
6. `bun run docs:check` — passed with no doc changes needed (same as Task 8's
   own commit, which also didn't touch `docs/architecture.md`; the hook only
   enforces that `src/verification/` and `src/workflow/` are named in
   `architecture.md`, which they already were before this task).

## Files changed (absolute paths)

- `/Users/inderjotsingh/ai/src/workflow/types.ts` — `AgentStep.verify?`,
  `WorkflowOutcome` `unverified` variant.
- `/Users/inderjotsingh/ai/src/workflow/define.ts` — `DefineVerifyOpts`,
  `expandVerifiedSteps`, `defineWorkflow(def, verifyOpts?)`.
- `/Users/inderjotsingh/ai/src/workflow/engine.ts` — `findUnverified`,
  `runWorkflow` unverified-outcome mapping.
- `/Users/inderjotsingh/ai/src/crew/engine.ts` — added `unverified` branch to
  `runCrew`'s `runWorkflow`-outcome handling (exhaustiveness fix, no crew
  behavior change).
- `/Users/inderjotsingh/ai/src/cli/flow.ts` — `unverified` branches in
  `runFlow` (artifact) and `main()` (console + exit code), mirroring
  `src/cli/crew.ts`.
- `/Users/inderjotsingh/ai/tests/workflow/verify-wiring.test.ts` (new) — 4
  tests: unsupported→unverified, supported→done, no-verify-flag→untouched
  (asserts verifyDeps never called), no-verifyOpts-at-all→unchanged.

## Concerns / follow-ups

- `docs/architecture.md` still has zero mentions of `expandVerification`,
  `StepKind.Verify`, `UnverifiedMarker`, or this workflow-level opt-in — this
  matches Task 8's own precedent (the doc explicitly defers "full section" to
  Task 14) and the task brief's instruction not to do a full docs pass here,
  but it means Task 14 (or whichever task owns the docs pass) has two
  commits' worth of undocumented mechanism to write up, not one.
- The `src/crew/engine.ts` `unverified` branch added here is currently dead
  code in practice: `runCrew`'s call to `runWorkflow` never routes through
  `defineWorkflow`'s new optional `verifyOpts` param (the crew compiler does
  its own splice via `compileToWorkflow`'s direct call to
  `expandVerification`, bypassing `defineWorkflow`'s second arg entirely), so
  `runWorkflow` itself can never observe an `UnverifiedMarker` on the crew
  path — the crew's existing `findUnverified(outcome.output)` on the `done`
  branch is what actually fires. The new branch exists only for
  type-exhaustiveness/defensive correctness, not because it's reachable
  today. Worth a note if a future slice consolidates the two mapping sites.
- No workflow declaration under `workflows/*` opts into `verify` yet (out of
  scope here), and `src/cli/flow.ts`'s `main()` still calls plain
  `getWorkflow(name)` without ever passing `verifyOpts` through
  `defineWorkflow`, so no real CLI-run workflow will actually produce an
  `unverified` outcome yet. That's expected: wiring real Ollama-backed
  `VerifyDeps` into the CLI (for both crew and workflow surfaces) is Task
  10's job per Task 8's commit message.
