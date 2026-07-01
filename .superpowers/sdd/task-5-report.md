# Task 5 report — `src/crew/compile.ts`

## Status: DONE

## What was implemented
- `src/crew/compile.ts`:
  - `composeTaskInput(task, ctx, deps)` — builds the task prompt: description +
    "Expected output: ..." + either the crew's root `ctx.input` (deps.length === 0)
    or each dependency's `ctx[dep]` (stringified if not already a string).
  - `compileToWorkflow(crew: CrewDef): WorkflowDef` — maps each `Task` to an
    `AgentStep`: `agent = task.member`, `dependsOn = effectiveTaskDeps(task, i, crew.tasks)`
    (reused from `src/crew/define.ts`, not re-derived), `input` closes over the
    resolved `deps` and calls `composeTaskInput`, `output = task.output ?? z.string()`.
    The assembled `{ id, description, steps }` is passed through `defineWorkflow(...)`
    as the second validation gate (unique ids, resolvable deps, acyclic).
  - `buildHierarchicalOrchestrator(crew, onBeforeDelegate?): Agent` — builds one
    `Agent` per member via `buildCrewAgent(m, m.tools)`, composes a manager system
    prompt (role framing + optional crew description + a rendered task list), and
    calls `createOrchestrator({ name: crew.id, model: createOllamaModel(crew.managerModel ?? qwenRouter), systemPrompt, agents, onBeforeDelegate })`.

- `tests/crew/compile.test.ts` — the brief's test verbatim, with two small
  TypeScript-safety fixes (see Self-review below).

## TDD record
- RED: wrote `tests/crew/compile.test.ts` first; `bun test tests/crew/compile.test.ts`
  failed with `Cannot find module '../../src/crew/compile.ts'` (module not found,
  as expected — no implementation existed yet).
- GREEN: added `src/crew/compile.ts` verbatim from the brief; re-ran the test —
  3 pass / 0 fail / 12 expect() calls.

## Verification
- `bun test tests/crew/compile.test.ts` → 3 pass, 0 fail, 12 expect() calls.
- `bun run typecheck` → clean (after the test-file fix below).
- `bun run lint:file -- "src/crew/compile.ts" "tests/crew/compile.test.ts"` → clean
  (after running `bunx biome check --write` on both files to apply import-order +
  formatting fixes; see below).
- `bun run docs:check` → passes (`src/crew/` subsystem already documented from
  Tasks 1-4; no new subsystem introduced by this task).
- Full suite: `bun test` → 213 pass, 15 skip, 0 fail, 420 expect() calls across
  73 files (~50.7s). No regressions.

## Files changed
- `src/crew/compile.ts` (new)
- `tests/crew/compile.test.ts` (new)

Commit: `81eb124 feat(crew): compile sequential->workflow, hierarchical->orchestrator`

## Self-review

**delegate-tool-name prefix verification (explicitly required by the task):**
Read `src/core/delegate.ts`:
```ts
export function delegateToolName(agent: Agent): string {
  return `delegate_to_${agent.name}`;
}
```
Confirmed the prefix is exactly `delegate_to_`, matching the brief's test
assertion (`delegate_to_researcher`, `delegate_to_writer`) with no changes
needed. `createOrchestrator` (in `src/core/orchestrator.ts`) registers each
agent's tool under `tools[delegateToolName(agent)]`, so `Object.keys(orch.tools)`
includes those names plus the `CAPABILITY_GAP_TOOL` key — the test's
`expect.arrayContaining([...])` correctly allows for that extra key.

**Deviations from the brief's literal test/source text (both mechanical, not
semantic):**
1. `tests/crew/compile.test.ts`: `noUncheckedIndexedAccess: true` in
   `tsconfig.json` makes `const [s0, s1] = wf.steps` type as possibly
   `undefined`, so the brief's test as pasted failed `bun run typecheck`
   (`TS18048` x3). Fixed by inserting a narrowing guard immediately after the
   destructure: `if (!s0 || !s1) throw new Error('expected two steps');`. This
   changes nothing about what the test verifies — `wf.steps` is already
   asserted to have length 2 on the previous line — it just satisfies strict
   null checks. No other logic touched.
2. Both new files were run through `bunx biome check --write` to fix
   import-sort order and long-line wrapping (project's biome config wraps
   object literals/imports more aggressively than the brief's inline
   formatting). Purely cosmetic — no code semantics changed. Confirmed via
   diff that only import order and line-wrapping changed.

**Design/behavior notes (matches brief intent):**
- `compileToWorkflow` deliberately does NOT re-derive "depends on previous
  task by default" logic — it calls `effectiveTaskDeps` from `src/crew/define.ts`
  (Task 3's function), keeping the sequential-default rule defined in exactly
  one place shared by both `defineCrew`'s cycle-check and this compiler.
  Verified the two are import-compatible (module already exists, no changes
  needed there).
- `compileToWorkflow` passes the compiled workflow through `defineWorkflow`
  as a second validation gate, per the brief — this means an invalid compiled
  workflow (e.g., a naming collision that somehow slipped past `defineCrew`)
  throws `WorkflowError` rather than silently producing a broken `WorkflowDef`.
  Since `crew.tasks` ids feed 1:1 into `steps` ids and `defineCrew` already
  guarantees uniqueness/acyclic/resolvable at crew-construction time, this
  second gate is currently redundant-but-cheap defense in depth (matches the
  brief's stated intent: "Reuse the workflow validator as a second gate").
- `buildHierarchicalOrchestrator` passes `m.tools` through as the `tools`
  param to `buildCrewAgent`, which itself falls back to `member.tools ?? tools ?? {}`
  — so this is effectively a no-op double-pass of the same value today, but
  matches the brief's exact code and keeps `buildCrewAgent`'s existing
  fallback logic (Task 2) untouched. Not a bug, just worth flagging as a
  slightly redundant pass-through if a future task wants to simplify.
- Confirmed `qwenRouter` is exported as `models/qwen-router.ts`'s default
  export (`ModelDeclaration`), matching the brief's import
  `import qwenRouter from '../../models/qwen-router.ts'`.

## Concerns
- None blocking. The two typecheck/lint deviations above are purely
  mechanical (strict-null-check guard; biome auto-formatting) and don't
  change behavior — flagging them for transparency since the task said "get
  exactly" the brief's behaviors, and I want it clear that 100% of the logic
  is verbatim from the brief; only two non-semantic lines were touched to
  satisfy this repo's stricter lint/typecheck gates than the brief's
  raw snippet assumed.
- `docs/architecture.md` was not touched — the `src/crew/` subsystem was
  already documented by an earlier task in this slice, and `bun run docs:check`
  confirms no undocumented subsystem exists. If the architecture doc's
  description of `src/crew/` doesn't yet mention `compile.ts`'s two
  constructors (sequential->workflow, hierarchical->orchestrator) specifically,
  that's worth a follow-up doc-accuracy pass at the slice's final review
  (per the repo's "the slice's final review audits the doc against the diff"
  rule) — I did not independently re-audit the prose there since Tasks 1-4
  already own that ground and this task's brief did not ask for a docs edit.
