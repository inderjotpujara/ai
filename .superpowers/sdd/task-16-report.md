# Task 16 report — `builder.ts` (crew/workflow-builder orchestrator)

## Implemented
- `src/crew-builder/builder.ts` — `buildCrewOrWorkflow(need, deps): Promise<CrewBuildResult>`, wrapped in `withCrewBuildSpan`.
- `src/crew-builder/resolve-members.ts` — exported the previously-private `referencedAgents(ir, shape)` helper (no logic change).
- `tests/crew-builder/builder.test.ts` — 2 end-to-end tests (written path, declined path), adapted from the brief to Directive 1/2's contract.

## Ordering used (per Directive 2, overriding the brief's draft)
1. `classify` → `rec.event('classified', {shape})`.
2. `analyze` → `rec.event('analyzed')`.
3. Regeneration loop (`attempt = 0..MAX_REGENERATIONS`, `MAX_REGENERATIONS = 1`):
   a. `planNodes` → `planEdges` → `rec.event('generated', {attempt})`.
   b. `planned = referencedAgents(ir, shape).filter(n => !existingAgents().has(n))` — no building here, just the diff.
   c. `validateIR(ir, shape, { ..., toBeBuilt: planned }, need)` → `rec.event('validated', {attempt, issues})`.
   d. break on `issues.length === 0`.
4. No valid IR / issues remain → `finish(..., {kind:'invalid', issues})`.
5. `deps.confirm(renderSummary(ir, shape, planned))` — summary shows the planned new-agent names. Declined → `finish(..., {kind:'declined'})`.
6. `resolveMissingAgents(ir, shape, deps)` — the ONE point where agents are actually built + IR refs rewritten. `resolved.abandoned` → `finish(..., {kind:'abandoned', reason})`.
7. `transpile(resolved.ir, shape)` → `writeCrewOrWorkflow(resolved.ir.id, source, shape, deps.paths)` → `rec.event('written')` → `finish(..., {kind:'written', shape, name: resolved.ir.id, files, builtAgents: resolved.builtAgents}, resolved.ir)`.

This satisfies Directive 2's constraint: `resolveMissingAgents` is called exactly once, after consent, never inside the regeneration loop — so a retry never re-builds an agent that was already built (which `existingAgents()`, an in-memory snapshot, wouldn't yet reflect).

`finish()` mirrors the brief's helper but computes the member/step count from `resolved.ir` (the rewritten IR) rather than the pre-resolve `ir`, and reports `result.builtAgents.length` (Directive 1's actual built list) rather than a loop-local count.

## TDD

**RED** — wrote `tests/crew-builder/builder.test.ts` against a not-yet-existing `builder.ts`:
```
bun test tests/crew-builder/builder.test.ts
→ error: Cannot find module '../../src/crew-builder/builder.ts'
0 pass, 1 fail
```

**GREEN** — implemented `src/crew-builder/builder.ts`:
```
bun test tests/crew-builder/builder.test.ts
→ 2 pass, 0 fail, 6 expect() calls
```

**Full suite + typecheck + lint:**
```
bun run typecheck        → clean (tsc --noEmit, no errors)
bun test tests/crew-builder/   → 52 pass, 0 fail, 104 expect() calls (13 files)
bun run lint:file -- src/crew-builder/builder.ts src/crew-builder/resolve-members.ts tests/crew-builder/builder.test.ts
  → first pass found 2 formatting violations (line-wrap style); auto-fixed via `bunx biome check --write` on the same 3 files
  → re-run: "Checked 3 files in 4ms. No fixes applied." (clean)
```
Also re-ran `bun test tests/crew-builder/resolve-members.test.ts` right after exporting `referencedAgents` (before touching builder.ts) to confirm the export caused no breakage: 8 pass, 0 fail.

## Files
- `/Users/inderjotsingh/ai/src/crew-builder/builder.ts` (new)
- `/Users/inderjotsingh/ai/src/crew-builder/resolve-members.ts` (modified: `function referencedAgents` → `export function referencedAgents`, no other change)
- `/Users/inderjotsingh/ai/tests/crew-builder/builder.test.ts` (new)

## Self-review
- Used `resolved.ir` (rewritten IR) for `transpile`/`writeCrewOrWorkflow`/`finish`'s count, not the pre-resolve `ir` — required by Directive 1 so a renamed agent ref actually lands in the generated source.
- `renderSummary` takes `planned` (names not yet built, computed before consent) rather than `builtAgents` (names actually built, known only after consent) — matches "show the planned new-agent names" in the directive.
- The written-path test sets `buildMissingAgent` to throw if called, and `existingAgents` includes the referenced agent (`web_fetch`) — confirms `planned` is empty and `resolveMissingAgents` performs no real build on this path, per the task's guidance.
- The declined-path test also has `buildMissingAgent` throw-on-call — confirms building never happens before consent, i.e. `resolveMissingAgents` runs strictly after the `confirm` gate.
- No `generateObject`, no `any`, no `console.log`; `type` (not `interface`) throughout; early returns in the loop/finish logic.
- Committed only my 3 files (`git add <specific files>`, not `-A`) — the working tree had many other in-flight SDD-task changes from concurrent tasks in this slice; those were left untouched and unstaged.

## Concerns
- None blocking. One minor note: `finish()`'s `ir` param is optional and only used for the `written` count; every other branch passes it as `undefined`, which is intentional (count is irrelevant for declined/invalid/abandoned) and matches the brief's original helper shape.
- Commit went through the repo's `docs-check` pre-commit hook cleanly (no `src/<subsystem>` doc gap flagged) since `crew-builder` is already a documented subsystem in `docs/architecture.md` from earlier Slice-19 tasks.
- Overwrote a stale `.superpowers/sdd/task-16-report.md` that contained unrelated content ("provisioning fit-math tuning (WS4)") from a different slice's task numbering — clearly a leftover file, not this task's report.

## Follow-up: missing test coverage added (reviewer-flagged gap)

A reviewer flagged that the original 2 tests (written-path, declined-path) never exercised the auto-build-agent branch, the invalid (goal-alignment-rejected) branch, or the abandoned branch — leaving the "build exactly once, after consent, never inside the regen loop" invariant (Directive 2, above) completely untested. Added 3 tests to `tests/crew-builder/builder.test.ts`; `src/crew-builder/builder.ts` was NOT touched (confirmed correct as shipped).

1. **`auto-builds a missing referenced agent exactly once, after consent (D2 invariant)`** — `existingAgents: () => []`, a workflow IR references `web_fetch` via an agent step. `buildMissingAgent` is a call-counting stub gated on a `confirmed` flag set by `confirm`: it throws `'built before consent!'` if called before `confirm` resolves. Asserts `calls === 1` (not 0, not >1 — catches both a missed build and a double-build/inside-the-loop regression), `result.kind === 'written'`, and `result.builtAgents` contains `'web_fetch'`.
2. **`returns invalid with a goal-alignment issue when the judge rejects both attempts`** — scripted queue covers both regeneration attempts (classify, then plan-nodes/plan-edges/judge ×2), judge returns `{aligned: false}` both times. Referenced agent (`web_fetch`) is already in `existingAgents()` so no build is attempted. `confirm` and `buildMissingAgent` both throw if called (proving consent/build are never reached on the invalid path — matches the code: the `issues.length > 0` early-return happens before `deps.confirm`). Asserts `result.kind === 'invalid'`, `issues` contains a `field: 'goal-alignment'` entry, `buildCalls === 0`, and no `wf.ts` file exists in the temp workflows dir.
3. **`returns abandoned when a required agent build is declined/fails`** — referenced agent missing from `existingAgents()`, `confirm` grants consent, but `buildMissingAgent` returns `null` (decline/failure). Asserts `result.kind === 'abandoned'` and no `wf.ts` file was written.

**Verification:**
```
bun test tests/crew-builder/builder.test.ts   → 5 pass, 0 fail, 15 expect() calls
bun test tests/crew-builder/                  → 55 pass, 0 fail, 113 expect() calls (13 files) — no regressions
bun run typecheck                             → clean
bun run lint:file -- tests/crew-builder/builder.test.ts → clean (Checked 1 file, no fixes applied)
```
No bug surfaced in `builder.ts` — all three new tests confirmed the shipped orchestration order (build-once-after-consent, invalid short-circuits before consent, abandoned on declined/failed build) on the first try.

Committed only `tests/crew-builder/builder.test.ts` (test-only change, `builder.ts` untouched).
