# Task 9 report — deterministic IR→TypeScript transpiler (`transpile.ts`)

## Status
COMPLETE. Commit `bfa2619` — `feat(crew-builder): deterministic IR->TS transpiler`.

## Implemented
- `src/crew-builder/transpile.ts` — `transpile(ir, shape): string`, deterministic (no model).
  - `transpileWorkflow` renders `defineWorkflow({ id, description?, steps: [...] })`
    with imports `z`, `defineWorkflow` (`../src/workflow/define.ts`), `StepKind`
    (`../src/workflow/types.ts`), and the seven safe helpers from
    `../src/crew-builder/safe-helpers.ts`.
  - `transpileCrew` renders `defineCrew({ id, description?, process, members, tasks })`
    with imports `z`, `Capability`/`PreferPolicy` (`../src/core/types.ts`),
    `defineCrew` (`../src/crew/define.ts`), `CrewProcess` (`../src/crew/types.ts`).
  - Every string value goes through `JSON.stringify` (`j()` helper) — no raw
    interpolation (injection/escaping safe).
  - `StepKind`/`CrewProcess` emitted as member forms (`StepKind.Tool`,
    `CrewProcess.Sequential`, etc.).
  - Input descriptors → `fromInput()`/`fromStep(...)`/`fromTemplate(...)`;
    predicates → `whenEquals/whenContains/whenTruthy(...)`; map source → `mapOver(...)`.
  - Generated modules target repo-root `crews/`/`workflows/`, hence the `../src/...`
    relative imports (matches the existing `crews/research-crew.ts` +
    `workflows/fetch-then-summarize.ts` hand-written files).
- `tests/crew-builder/transpile.test.ts` — the brief's two golden tests
  (workflow: defineWorkflow + StepKind.Tool + `fromInput()` + `fromStep("fetch")`
  + `"fetch_then_sum"`; crew: defineCrew + CrewProcess.Sequential + `"researcher"`).

## Enum-comparison deviation (as directed by the interface note)
`CrewIR.process` is a `CrewProcess` ENUM value (Task 1 `ir.ts` uses
`z.nativeEnum(CrewProcess)`), NOT a string. The brief's draft compared
`ir.process === 'hierarchical'`, which fails typecheck ("no overlap" — enum vs
string literal). Fixed by importing `CrewProcess` from `../crew/types.ts` and
comparing `ir.process === CrewProcess.Hierarchical`. The test also constructs the
IR with `process: CrewProcess.Sequential` rather than the string `'sequential'`,
for the same type-correctness reason. A `// NOTE (deviation)` comment records this
in `transpile.ts`.

## Golden-string reconciliation
None needed — every expected substring matched the renderer output verbatim
(the brief's test uses `"input: fromStep(\"fetch\")"`; my test writes the same
string unescaped as `'input: fromStep("fetch")'`). No renderer change was made to
satisfy the tests.

## TDD RED → GREEN
- RED: `bun test tests/crew-builder/transpile.test.ts` →
  `Cannot find module '../../src/crew-builder/transpile.ts'` (0 pass, 1 fail).
- GREEN (after implementing): `2 pass, 0 fail, 8 expect() calls`.

## Gates (focused, per coordinator directive — did NOT run full `bun test`)
- `bun test tests/crew-builder/` → **30 pass / 0 fail** across 8 files (no regressions).
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/crew-builder/transpile.ts tests/crew-builder/transpile.test.ts`
  → clean (biome; import-ordering + object-formatting auto-fixes applied before commit).

## Self-review / concerns
- Generated TS is syntactically valid (matches the hand-written `crews/`/`workflows/`
  siblings' import shape + closing `});`); Task 10 will dynamic-import to prove re-parse.
- Verify/dependsOn/tools/agentRef are all rendered conditionally and JSON-safely.
- No concerns blocking Task 10.
