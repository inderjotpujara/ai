# Task 7 Report: plan-edges stage → assemble IR (Slice 19)

## Implemented
- `src/crew-builder/plan-edges.ts` — `planEdges(need, shape, analysis, nodes, model): Promise<CrewIR | WorkflowIR>`.
  - `shape === 'crew'`: builds a prompt listing `nodes.members` + `analysis`, wraps `need` via `delimitNeed`, calls `model.object({ schema: CrewIRSchema, prompt })`, then explicitly re-validates with `CrewIRSchema.parse(...)`.
  - `shape === 'workflow'`: builds a prompt listing `nodes.steps` + `analysis` + a `HELPER_DOC` block describing the legal input/predicate/map descriptor shapes (`fromInput`/`fromStep`/`fromTemplate`, `whenEquals`/`whenContains`/`whenTruthy`, `mapOver`) as the model's only legal ops, calls `model.object({ schema: WorkflowIRSchema, prompt })`, then `WorkflowIRSchema.parse(...)`.
  - The explicit `.parse()` after `model.object()` matters for the unit-test seam: the test's `BuilderModel.object` mock ignores the schema arg entirely and echoes back whatever object it's given, so validation only actually happens via the schema's own `.parse()` call inside `planEdges`. In production (`src/agent-builder/deps.ts`'s `makeBuilderModel`), `model.object` already validates via `parseAgainst` internally — so this is a deliberate belt-and-suspenders re-validation the brief calls for ("output MUST be parsed through the IR schema... throws → caller's retry loop handles it"), not redundant dead code.
- `tests/crew-builder/plan-edges.test.ts` — one test: builds a 2-step workflow via the mock model, asserts `ir.steps.length === 2`.

## TDD RED → GREEN
- RED: `bun test tests/crew-builder/plan-edges.test.ts` → `error: Cannot find module '../../src/crew-builder/plan-edges.ts'` (0 pass / 1 error) before the source file existed.
- GREEN: after writing `src/crew-builder/plan-edges.ts` verbatim per the brief:
  ```
  bun test tests/crew-builder/plan-edges.test.ts
  1 pass, 0 fail, 1 expect() call
  ```
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- Full crew-builder suite after the change: `bun test tests/crew-builder/` → 19 pass, 0 fail, 33 expect() calls across 6 files (no regressions against the other 5 stages already committed for this slice: `ir.ts`, `safe-helpers.ts`, `classify.ts`, `analyze.ts`, `plan-nodes.ts`).

## Lint
- `bun run lint:file -- src/crew-builder/plan-edges.ts tests/crew-builder/plan-edges.test.ts` initially failed (4 errors, 1 warning): Biome wanted the multi-arg calls / import lists reformatted onto multiple lines (project formatting rules differ from the brief's single-line style), the `./ir.ts` import unsorted (Biome's `organizeImports` groups `type` specifiers differently), and an unused `CrewIR` type import in the test file (the brief's test snippet imports `CrewIR` but never references it — only `WorkflowIR` is used in the cast).
- Fixed via `bunx biome check --write` on both files (formatting/import-order), plus a manual edit dropping the unused `CrewIR` import from the test file (kept `WorkflowIR` only).
- Deviation from the brief: brief's literal code is functionally unchanged — only whitespace/line-wrapping and the one import list differ from the brief's verbatim text.
- Re-ran `bun run lint:file -- src/crew-builder/plan-edges.ts tests/crew-builder/plan-edges.test.ts` after fixes → clean (`Checked 2 files in 2ms. No fixes applied.`).
- Re-verified `bun test` + `bun run typecheck` after the lint fixes → still green (shown above).

## Files
- `/Users/inderjotsingh/ai/src/crew-builder/plan-edges.ts` (new)
- `/Users/inderjotsingh/ai/tests/crew-builder/plan-edges.test.ts` (new)

## Self-review
- Interfaces match the brief and upstream types exactly: `NodePlan` (`{ members?, steps? }`) from `plan-nodes.ts` (Task 6), `Shape` from `types.ts`, `CrewIRSchema`/`WorkflowIRSchema`/`CrewIR`/`WorkflowIR` from `ir.ts` (Task 1), `BuilderModel` from `agent-builder/types.ts`, `delimitNeed` from `agent-builder/prompt.ts`.
- Confirmed `delimitNeed` neutralizes embedded `<need>` tags (prompt-injection guard) — used for the raw `need` string in both branches; `analysis` and `nodes` are trusted pipeline-internal output (not user-controlled), so they're interpolated directly, consistent with `plan-nodes.ts`'s existing pattern.
- Confirmed no `generateObject` import anywhere — only the `BuilderModel.object` seam is used, per the global constraint.
- No `console.log`; file stays small and single-purpose (one exported function + one prompt-doc constant).
- `HELPER_DOC` gives the model the closed descriptor vocabulary matching `ir.ts`'s discriminated unions exactly (`fromInput`/`fromStep`/`fromTemplate`, `whenEquals`/`whenContains`/`whenTruthy`, `mapOver`), so the model never needs to author real closures.

## Concerns
- Test coverage is minimal (only the workflow happy path, per the brief's Step 1). The crew branch and the "invalid IR throws" contract are exercised only implicitly via Zod's own guarantees inside `planEdges`, not by a dedicated test in this task — flagging for the controller in case a follow-up hardening pass wants a crew-shape test and/or a throws-on-schema-mismatch test.

## Commit
`a8c483d feat(crew-builder): plan-edges stage assembles validated IR`

## Fix (review follow-up)
Reviewer found two gaps in the original implementation, addressed as follows:

1. **Important — crew prompt lacked closed-vocabulary teaching.** The crew branch's prompt never told the model `process` must be exactly `"sequential"` or `"hierarchical"`, nor that every task needs `expectedOutput`. Added a line to the crew prompt in `src/crew-builder/plan-edges.ts`: `'Set "process" to exactly "sequential" or "hierarchical". Each task needs: id, description, expectedOutput, member (must equal one of the member names). Use dependsOn to order tasks.'`
2. **Minor — workflow prompt lacked dependsOn guidance.** Added a line to the workflow prompt: `"Set dependsOn explicitly whenever a step's real upstream is not simply the previous step in the list."`
3. **Important — closed the test gap flagged above.** Added to `tests/crew-builder/plan-edges.test.ts`:
   - `assembles a valid crew IR` — happy-path test with a valid `CrewIR` (process `sequential`, one member, one task with `expectedOutput`), asserts `ir.id` and `ir.members` names.
   - `rejects an invalid crew IR (missing process)` — fake model omits `process`; asserts `planEdges(...)` rejects (Zod throws inside `CrewIRSchema.parse`, not silently coerced).
   - `rejects an invalid workflow IR (missing input)` — fake model's step omits `input`; asserts `planEdges(...)` rejects for the workflow shape too.

### Commands run
- `bun test tests/crew-builder/plan-edges.test.ts` → 4 pass, 0 fail, 5 expect() calls.
- `bun test tests/crew-builder/` → 22 pass, 0 fail, 37 expect() calls across 6 files (no regressions).
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/crew-builder/plan-edges.ts tests/crew-builder/plan-edges.test.ts` → clean (`Checked 2 files in 4ms. No fixes applied.`).

### Fix commit
`b1682ad fix(crew-builder): document crew IR fields in plan-edges prompt + crew/invalid-IR tests`
