# Task 8 report: two-tier (structural + semantic) IR validation gate

## Implemented

`src/crew-builder/validate.ts` exports `validateIR(ir, shape, ctx, need = ''): Promise<ValidationIssue[]>`.

- **Tier 1 STRUCTURAL (sync)**, run first:
  - `structuralWorkflow` (shape `'workflow'`): duplicate step ids, agent-step
    refs resolve to `existingAgents ∪ toBeBuilt`, tool-step refs are
    palette-only (`packNames`), every `fromStep`/branch-predicate/map ref
    names a real step id, branch `whenTrue`/`whenFalse` targets exist, and
    the dependency graph is acyclic (`assertAcyclic`, see below).
  - `structuralCrew` (shape `'crew'`): duplicate member names, duplicate task
    ids, member `agentRef` resolves to `existingAgents ∪ toBeBuilt`, member
    `tools` are palette-only, task `member` resolves to a declared member,
    and the task graph is acyclic (`assertAcyclic`).
  - If either producer returns any issues, `validateIR` returns them
    immediately — **no model call is made**.
- **Tier 2 SEMANTIC (async)**, only reached when tier 1 is clean:
  `goalAlignment` calls `ctx.model.object({ schema: AlignSchema, prompt })`
  (a `z.object({ aligned, reason })` schema) asking whether the plan
  accomplishes `need`; `aligned: false` becomes one `{ field: 'goal-alignment', problem: reason }` issue.
- Empty array = valid.

## The `assertAcyclic` extraction (Directive 1)

Per the two critical directives, I did **not** use the brief's `as never`
stub-mapping through `defineWorkflow`/`defineCrew`. Instead:

- Added `export function assertAcyclic(ids: string[], edges: Array<[from: string, to: string]>): void`
  to `src/workflow/define.ts`. It is a pure graph gate with zero knowledge of
  `Step`/`Task`/closures: it checks every edge's `from`/`to` is a known id
  (throws `Error('dependency edge references unknown id "…"')` otherwise),
  then runs Kahn's topological sort and throws `Error('dependency graph has a cycle')`
  if not every id was visited.
- **Refactored `defineWorkflow`** (`src/workflow/define.ts`) to build
  `edges: Array<[string, string]>` from `effectiveDeps(step, i, steps)` (dep → step.id)
  and call `assertAcyclic([...ids], edges)` inside a `try/catch`, rethrowing
  as `WorkflowError('workflow <id>: <message>')`. The branch-target existence
  check stays separate (branch targets aren't dependency edges). Removed the
  duplicated per-dep resolution loop and the inline Kahn block — both now
  live only in `assertAcyclic`.
- **Refactored `defineCrew`** (`src/crew/define.ts`) the same way: builds
  edges from `effectiveTaskDeps`, calls `assertAcyclic([...taskIds], edges)`,
  rethrows as `CrewError`. This was clean (crew already imports from
  `../workflow/*` elsewhere — `compile.ts`, `engine.ts` — so `crew/define.ts`
  importing `assertAcyclic` from `workflow/define.ts` matches existing
  layering), so **both** `defineWorkflow` and `defineCrew` now share the one
  Kahn implementation — I did not need to fall back to the "leave `defineCrew`
  as-is" escape hatch.
- **`validate.ts` calls `assertAcyclic` directly** with the IR's own ids and
  effective edges (`workflowEdges`/`crewTaskEdges`, small local functions that
  mirror `effectiveDeps`/`effectiveTaskDeps` over the plain IR shape — no
  `Step`/`CrewDef` objects, no stubs, no `as never`, no `any`, anywhere in
  `src/`).

One intentional trade-off: extracting the check into a pure `(ids, edges)`
helper means the thrown messages are id-only, not "step/task"-flavored (e.g.
`workflow wf: dependency edge references unknown id "ghost"` instead of the
old `step b: unknown dependsOn target "ghost"`). The existing regression
tests only assert loose regexes (`/unknown.*ghost/i`, `/cycle/i`), which still
match; I did not weaken any assertion to make this pass.

## Directive 2 (CrewProcess)

`structuralCrew`/`validate.ts` never compare `ir.process` against a string —
in fact the two-tier structural/semantic check never needs to branch on
`process` at all, so `CrewProcess` isn't imported (no unused import).

## TDD evidence

RED (before `src/crew-builder/validate.ts` existed):
```
$ bun test tests/crew-builder/validate.test.ts
error: Cannot find module '../../src/crew-builder/validate.ts' from '/Users/inderjotsingh/ai/tests/crew-builder/validate.test.ts'
 0 pass
 1 fail
```

GREEN (after implementing `validate.ts`):
```
$ bun test tests/crew-builder/validate.test.ts
 4 pass
 0 fail
 4 expect() calls
Ran 4 tests across 1 file. [81.00ms]
```

Workflow + crew regression (run after refactoring `defineWorkflow` alone,
then again after also refactoring `defineCrew`):
```
$ bun test tests/workflow/
 21 pass
 0 fail
 41 expect() calls

$ bun test tests/workflow/ tests/crew/
 41 pass
 0 fail
 91 expect() calls
```

Full targeted suite + typecheck + lint, final state:
```
$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun test tests/crew-builder/ tests/workflow/ tests/crew/
 67 pass
 0 fail
 132 expect() calls
Ran 67 tests across 18 files. [155.00ms/158.00ms across two runs]

$ bun run lint:file -- src/crew-builder/validate.ts src/workflow/define.ts src/crew/define.ts tests/crew-builder/validate.test.ts
Checked 4 files in 5ms. No fixes applied.

$ bun run docs:check
✔ docs-check: living docs present + linked; every src subsystem documented.
```

## Files changed

- `src/crew-builder/validate.ts` — new: `validateIR` + `ValidateCtx` + the
  structural/semantic tiers.
- `tests/crew-builder/validate.test.ts` — new: the 4 tests from the brief
  (ghost `fromStep` ref, unknown agent, valid workflow, goal-misaligned via a
  fake `{aligned:false}` judge).
- `src/workflow/define.ts` — added `assertAcyclic`; `defineWorkflow` now
  calls it instead of inlining its own Kahn/dep-resolution logic.
- `src/crew/define.ts` — `defineCrew` now calls the shared `assertAcyclic`
  instead of inlining its own Kahn logic.

`docs/architecture.md` was not touched: no new subsystem was introduced
(`crew-builder`, `workflow`, `crew` are all already documented), and
`bun run docs:check` confirms no doc drift was introduced by this task.

## Self-review

- No `any`, no `as never` anywhere in `src/` (the two `as never` occurrences
  are in the test file's `BuilderModel` mocks, matching the pre-existing,
  widespread convention already used across `tests/agent-builder/*.test.ts`
  and the other `tests/crew-builder/*.test.ts` files for the same generic
  `object: <T>(...) => Promise<T>` mocking problem).
- `CrewIR.process` is never string-compared; not imported since unused.
- Two-tier ordering verified by test 2 (unknown agent) and test 1 (ghost
  ref): both return before `goalAlignment` would run — confirmed by
  inspection (`if (issues.length > 0) return issues;` precedes the
  `goalAlignment` call unconditionally for both shapes), and by the fact
  those two tests still pass with `okJudge` wired in (its `aligned: true`
  response would otherwise mask the structural issue if the tier ordering
  were wrong).
- Ran the full `tests/workflow/` + `tests/crew/` suites (not just the 4
  tests the task description called out) after each refactor step, so the
  `assertAcyclic` extraction is regression-verified beyond what was strictly
  required.

## Concerns

- The IR-level `workflowEdges`/`crewTaskEdges` helpers duplicate (in ~4 lines
  each) the "explicit `dependsOn` else previous item" rule that also lives in
  `effectiveDeps` (`src/workflow/types.ts`) and `effectiveTaskDeps`
  (`src/crew/define.ts`). I did not generalize those into a shared generic
  helper because `effectiveDeps` is typed against the real `Step` union
  (which requires `output`, `kind`, etc. — fields the plain IR doesn't carry)
  and genericizing it was out of scope for this task's directive (only
  `assertAcyclic` was called out for sharing). This is a small, low-risk
  duplication; flagging in case a later slice wants a shared generic
  `effectiveDepsOf<T extends {id: string; dependsOn?: string[]}>` helper.
- Error messages from `assertAcyclic` are less specific than the pre-refactor
  ones (no longer name the referencing step/task, just the bad id) — a
  deliberate trade for a domain-agnostic shared helper. All existing tests
  still pass since they assert loose regexes, but if anything downstream
  scrapes these exact strings for anything other than `.toThrow(/regex/)`,
  it's worth a second look (I didn't find any such usage in this repo).
- The pre-existing content of this report file (before I overwrote it) was
  about an unrelated Task 8 ("capture `lfs.oid` from the HF tree") from a
  different slice/numbering — looked like a stale leftover at this path, not
  something from this session. Flagging in case the ledger/controller
  expected that content to be preserved elsewhere.
