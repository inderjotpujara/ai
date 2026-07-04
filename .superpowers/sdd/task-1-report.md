# Task 1 report: IR types + Zod schemas (`ir.ts`) — Slice 19

## Status: DONE

## What was implemented

Created `src/crew-builder/ir.ts` — the declarative IR consumed by every later
Slice-19 crew-builder task — exactly as specified in the task brief, plus
`tests/crew-builder/ir.test.ts` with the brief's 3 tests verbatim.

Exports: `InputDescriptorSchema`/`InputDescriptor`, `PredicateDescriptorSchema`/
`PredicateDescriptor`, `WorkflowStepIRSchema`/`WorkflowStepIR`,
`WorkflowIRSchema`/`WorkflowIR`, `CrewMemberIRSchema`/`CrewMemberIR`,
`CrewTaskIRSchema`, `CrewIRSchema`/`CrewIR`. Step kinds are a Zod
`discriminatedUnion('kind', …)` over `agent`/`tool`/`branch`/`map` — kept as
`type` + discriminated union per the plan's constraint (IR unions stay `type`,
not converted to `enum`).

No deviations from the brief's code — it typechecked and passed as written.

## TDD evidence

**Step 1/2 — RED** (test file written first, referencing not-yet-existing `ir.ts`):

```
$ bun test tests/crew-builder/ir.test.ts
error: Cannot find module '../../src/crew-builder/ir.ts' from '/Users/inderjotsingh/ai/tests/crew-builder/ir.test.ts'
0 pass
1 fail
1 error
Ran 1 test across 1 file. [22.00ms]
```

**Step 3/4 — GREEN** (implemented `src/crew-builder/ir.ts` per brief, unchanged):

```
$ bun test tests/crew-builder/ir.test.ts
3 pass
0 fail
3 expect() calls
Ran 3 tests across 1 file. [39.00ms]

$ bun run typecheck
$ tsc --noEmit
(clean, no output)
```

**Lint** — `bun run lint:file -- src/crew-builder/ir.ts tests/crew-builder/ir.test.ts`
initially failed on Biome formatting (the brief's sample code has
multi-property object literals collapsed onto one line, which Biome's
formatter rejects). Fixed via `bunx biome check --write` (auto-format only —
no logic changes), then re-verified:

```
$ bun run lint:file -- src/crew-builder/ir.ts tests/crew-builder/ir.test.ts
Checked 2 files in 4ms. No fixes applied.

$ bun test tests/crew-builder/ir.test.ts
3 pass / 0 fail

$ bun run typecheck
(clean)
```

No `console.log` present (verified via grep — no matches, exit code 1).

## Deviation: docs hard-line (pre-commit gate)

The brief's Step 5 commit command failed on first attempt:

```
✖ docs-check failed (1):
  - subsystem src/crew-builder/ is not documented in docs/architecture.md
```

This is the repo's pre-commit hook (`bun run docs:check`), which blocks any
commit introducing a new `src/<subsystem>/` not mentioned in
`docs/architecture.md` — the brief didn't anticipate this since it only
scoped `ir.ts` + its test, and there is no `DOCS_OK` bypass for pre-commit
(only for pre-push). Per repo CLAUDE.md ("Don't ship a `src/**` change
without updating `docs/architecture.md`"), I added one new module-map table
row to `docs/architecture.md` (right after the Agent-builder row): a
**truthful, scoped** description marked `*(in progress, Slice 19)*` covering
only what Task 1 actually delivers (the IR schemas/types), explicitly noting
that generation/validation/compile land in later Slice-19 tasks and that
this entry will grow with them. This is not scope creep on the IR code
itself — only the minimum doc line the automated gate requires. Later tasks
should extend this same row rather than add a competing one.

Only `src/crew-builder/ir.ts`, `tests/crew-builder/ir.test.ts`, and this one
`docs/architecture.md` row were staged/committed — unrelated pending changes
already present in the working tree (`.remember/today-2026-07-04.md`,
`.superpowers/sdd/progress.md`, `.superpowers/sdd/task-1-brief.md` — from
surrounding slice/session orchestration, not this task) were left untouched
and unstaged.

## Files changed

- `src/crew-builder/ir.ts` (new)
- `tests/crew-builder/ir.test.ts` (new)
- `docs/architecture.md` (+1 module-map table row, docs-check compliance)

## Commit

`fa58d74` — `feat(crew-builder): IR types + Zod schemas`

## Self-review

- Brief's schema/type code used verbatim; only Biome reformatting applied
  (mechanical, no logic change).
- `WorkflowIRSchema` requires `steps.min(1)`; `CrewIRSchema` requires
  `members.min(1)` and `tasks.min(1)` — matches brief.
- Discriminated unions correctly reject unknown `kind` values (test 3
  confirms `WorkflowIRSchema` rejects `kind: 'nope'`).
- `MapStepIR`/`MapSubStepIR` are defined but not exercised by any of the 3
  brief tests — that's in-brief scope (the brief specifies exactly these 3
  tests); a later task exercising `map` steps should add coverage.
- No lint suppressions, no `any`, no `console.log`.

## Concerns

- None blocking. The one open item is the docs-hard-line addition above —
  flagged for the slice's final review to confirm the `crew-builder` row's
  wording stays accurate as later tasks land (generation, registry
  validation, compile-to-`WorkflowDef`/`CrewDef`), per the repo's "review
  audits docs against the diff for truth" rule.

## Review-fix follow-up (post-Task-1)

Applied 3 review findings to `ir.ts` + its test:

1. **Reuse canonical enum** — `CrewIRSchema.process` was
   `z.enum(['sequential', 'hierarchical'])`, a string-literal duplicate of
   the canonical `CrewProcess` string enum in `src/crew/types.ts`. Added
   `import { CrewProcess } from '../crew/types.ts';` and changed the field
   to `process: z.nativeEnum(CrewProcess)`. Since `CrewProcess.Sequential =
   'sequential'` and `CrewProcess.Hierarchical = 'hierarchical'`, existing
   JSON `"process":"sequential"` still parses identically — no behavior
   change, just removes the duplicate literal union.
2. **Missing inferred type export** — `CrewTaskIRSchema` had no
   corresponding `CrewTaskIR` type export, unlike every sibling schema
   (`CrewMemberIR`, `WorkflowStepIR`, etc.). Added
   `export type CrewTaskIR = z.infer<typeof CrewTaskIRSchema>;` immediately
   after the schema definition.
3. **Map-step test gap** — the original 3 tests never exercised the `map`
   step kind (flagged as an open concern above). Added two tests to
   `tests/crew-builder/ir.test.ts`: one asserting a valid workflow with a
   `tool` step producing `list` feeding a `map` step (`over: { kind:
   'mapOver', ref: 'list' }`, sub-step `{ kind: 'agent', agent: 'web_fetch',
   input: { kind: 'fromInput' } }`) parses successfully; one asserting the
   same graph with the `map` step's `step` field omitted is rejected.

### Commands run

```
$ bun test tests/crew-builder/ir.test.ts
 5 pass
 0 fail
 5 expect() calls
Ran 5 tests across 1 file. [31.00ms]

$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file -- src/crew-builder/ir.ts tests/crew-builder/ir.test.ts
$ biome check src/crew-builder/ir.ts tests/crew-builder/ir.test.ts
Checked 2 files in 33ms. No fixes applied.
```

### Commit

`139401c` — `fix(crew-builder): reuse CrewProcess enum in IR + CrewTaskIR export + map-step test`
