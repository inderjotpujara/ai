# Task 6 Report (Slice 19) — plan-nodes stage (`plan-nodes.ts`)

*(Reuses the per-slice `task-6-*` filename; previous content was the Slice-18
Task-6 report [hf-fetch atomic write]. Overwritten with the current Slice-19
Task-6 report.)*

**Status:** DONE
**Branch:** slice-19-crew-workflow-builder
**Commit:** f77bf0d — feat(crew-builder): plan-nodes stage (palette-only)

## What was implemented

- `src/crew-builder/plan-nodes.ts` — `planNodes(need, shape, analysis, model, packNames): Promise<NodePlan>`.
  - Flat, non-recursive Zod schemas: `MemberNode` (name/role/goal/backstory/requires/tools?), `StepNode`
    (id/kind∈{agent,tool,branch,map}/agent?/tool?), wrapped as `CrewNodes = { members }` /
    `WorkflowNodes = { steps }`.
  - `NodePlan = { members?; steps? }` exported as a type.
  - For `shape === 'crew'`: calls `model.object({ schema: CrewNodes, prompt })`, then **palette-only
    filters** `tools` on each member against a `Set(packNames)` — drops any tool name not present,
    mirroring `src/agent-builder/suggest-tools.ts`'s `valid.has(name)` drop pattern.
  - For `shape === 'workflow'`: calls `model.object({ schema: WorkflowNodes, prompt })` and returns
    `{ steps }` as-is (no tool-palette concept on workflow step nodes at this stage).
  - Prompt uses `delimitNeed(need)` for injection-guarding the free-text need, plus an explicit
    "palette-only" instruction line listing `packNames`.
  - Uses `BuilderModel.object` exclusively — no `generateObject` import, no `.text` use (this stage is
    structured-only).

- `tests/crew-builder/plan-nodes.test.ts` — 2 tests from the brief verbatim (plus a null-safety tweak,
  see Deviations):
  1. `crew node plan returns members` — feeds a fake `model.object` returning one member, asserts
     `plan.members?.[0]?.name === 'researcher'`.
  2. `drops tools not in the palette` — feeds a member with `tools: ['fetch', 'not_in_pack']` and
     `packNames = ['fetch']`, asserts the returned member's `tools` is filtered down to `['fetch']`.

## TDD evidence

**RED** (before `src/crew-builder/plan-nodes.ts` existed):
```
$ bun test tests/crew-builder/plan-nodes.test.ts
error: Cannot find module '../../src/crew-builder/plan-nodes.ts' from '/Users/inderjotsingh/ai/tests/crew-builder/plan-nodes.test.ts'
 0 pass
 1 fail
 1 error
```

**GREEN** (after implementing `plan-nodes.ts`):
```
$ bun test tests/crew-builder/plan-nodes.test.ts
 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [25.00ms]
```

**Typecheck** (clean):
```
$ bun run typecheck
$ tsc --noEmit
(no errors)
```

**Lint** (clean):
```
$ bun run lint:file -- src/crew-builder/plan-nodes.ts tests/crew-builder/plan-nodes.test.ts
$ biome check src/crew-builder/plan-nodes.ts tests/crew-builder/plan-nodes.test.ts
Checked 2 files in 3ms. No fixes applied.
```

## Files touched

- `src/crew-builder/plan-nodes.ts` (new)
- `tests/crew-builder/plan-nodes.test.ts` (new)

## Deviations from the brief

1. **Test null-safety**: the brief's test used `plan.members?.[0].name` /
   `plan.members?.[0].tools`. This project's `tsconfig` has strict indexed-access checking, so
   `tsc --noEmit` flagged `TS2532: Object is possibly 'undefined'` on the element access after the
   optional-chained array index (the `?.` only guards `members` being undefined, not element `[0]`
   itself). Fixed by adding a second `?.`: `plan.members?.[0]?.name` / `plan.members?.[0]?.tools`.
   No behavior change — purely a type-narrowing fix required to keep `bun run typecheck` clean.
2. **Formatting**: ran `bunx biome check --write` on both new files to apply the repo's biome
   formatting (multi-line argument lists, trailing commas, etc.) — content/logic unchanged from the
   brief's code, whitespace/wrapping only. `bun run lint:file` was red before this and clean after.

No other deviations — the brief's schemas, palette-drop logic, and prompt construction were used
verbatim.

## Self-review

- Palette-drop logic (`(m.tools ?? []).filter((t) => valid.has(t))`) correctly mirrors
  `suggest-tools.ts`'s `valid.has(name)` check; confirmed by the "drops tools not in the palette" test.
- Schema is flat/non-recursive per the stated design constraint (no nested node graphs at this stage —
  edges are deferred to Task 7).
- `StepNode.kind` uses a `z.enum` (not a string-literal union), consistent with the repo's
  "prefer enum over string literal unions for finite sets" style rule, expressed via Zod's own enum
  primitive since this is a runtime-validated schema field rather than a TS-level type.
- No `generateObject` import anywhere in the file — only the `BuilderModel.object` seam, matching the
  global constraint.
- No `console.log`, small single-purpose file (~40 lines of logic), no side effects beyond the two
  `model.object` calls.
- Workflow branch does not filter/validate `agent`/`tool` fields on `StepNode` against any palette —
  this matches the brief's scope (palette-only filtering is specified only for crew "tools"; workflow
  step-target validation is presumably Task 7's wiring/edges concern). Flagging this as a scope
  boundary, not a defect, since the brief only asked for crew tool-palette filtering here.

## Concerns

- None blocking. The only open question is whether workflow `StepNode.agent`/`.tool` references should
  also be validated against `packNames`/known agents at this stage — brief explicitly scopes
  palette-filtering to crew `tools` only, so left as specified; can be tightened in Task 7 if wiring
  needs it.
- Full suite (`bun test`) intentionally not run here per instruction — the controller runs it between
  tasks.
