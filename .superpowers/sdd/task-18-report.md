### Task 18 (Slice 21): thread degradation ledger through orchestrator delegation — report

> Note: this report path previously held Slice-19's Task-18 report ("chat
> multi-step gap trigger — route to crew/workflow builder", commit
> `190afc9`). That work is still landed on `main`/this branch; only this
> file is being overwritten to match the current slice's task numbering
> (Slice 21, Task 18: degradation ledger threading), per the same
> convention the prior note used for its own collision.

**Status:** Done.

**Commit:** `c10c995` — `feat(core): thread degradation ledger through orchestrator delegation`

**Files:**
- Modified `src/core/orchestrator.ts` — `createOrchestrator(opts)` options type gained `ledger?: DegradationLedger` (imported `type DegradationLedger` from `../reliability/ledger.ts`). In the tool-building loop, `asDelegateTool(agent, opts.onBeforeDelegate)` became `asDelegateTool(agent, opts.onBeforeDelegate, opts.ledger)`. Return type (`Agent`) unchanged.
- Modified `agents/super.ts` — `createSuperAgent(toolsFor, onBeforeDelegate?, ledger?)` gained a third optional param `ledger?: DegradationLedger`, forwarded into its `createOrchestrator({ ..., ledger })` call. This is the seam between the CLI and the orchestrator (`createSuperAgent` wraps `createOrchestrator` directly), so it's the natural place to thread the ledger down from the CLI.
- Modified `src/cli/chat.ts` — the `createSuperAgent(...)` call site (inside the `withMcpRun` callback, which already destructures `ledger` from its ctx per Task 12's restructure) now passes `ledger` as the third argument.
- Added `tests/core/orchestrator-degrade.test.ts` — builds a real sub-`Agent` and asserts `createOrchestrator({ model, systemPrompt, agents: [agent], ledger })` (with a `createLedger()` instance) returns a defined orchestrator exposing a `delegate_to_<name>` tool. Mirrors the construction pattern in `tests/core/orchestrator.test.ts`.

**Scope decision — crew.ts / flow.ts left untouched:**
Per the brief's conditional ("crew.ts/flow.ts IF they build orchestrators directly with delegate tools"), I read both:
- `src/cli/flow.ts` runs workflows through `runWorkflow`/`defaultRunAgentStep` — agent steps, not `asDelegateTool`/`createOrchestrator`. Not in scope.
- `src/cli/crew.ts` → `runCrewCli` → `runCrew` (`src/crew/engine.ts`). The **sequential** crew path also goes through the workflow engine (no delegate tools). Only the **hierarchical** crew path calls `buildHierarchicalOrchestrator` (`src/crew/compile.ts`), which does call `createOrchestrator` with delegate tools — but reaching it from `crew.ts` would require threading `ledger` through `CrewCliDeps` → `CrewDeps` → `runCrew` → `buildHierarchicalOrchestrator`, none of which appear in this task's declared file list or its commit-hygiene note (which enumerates only `orchestrator.ts`, `chat.ts`, "any createSuperAgent seam file", and the test). Left this thread un-wired rather than expand scope past what was briefed — flagging as a gap below.

**TDD:**
- Wrote `tests/core/orchestrator-degrade.test.ts` first. `bun test tests/core/orchestrator-degrade.test.ts` **passed** even pre-implementation — Bun strips types at runtime (no type checking), so an extra object-literal property (`ledger`) on the pre-change `createOrchestrator` options isn't caught by the test runner itself.
- The real RED signal was `bun run typecheck`, which reported `TS2353: Object literal may only specify known properties, and 'ledger' does not exist in type '{ name?: ...; model: LanguageModel; systemPrompt: string; agents: Agent[]; onBeforeDelegate?: BeforeDelegate | undefined; }'.` against the pre-change type — confirmed the test was meaningfully failing before implementing.
- GREEN: after adding `ledger?: DegradationLedger` to the options type and threading it through, typecheck went clean and the test still passes.

**Verification:**
- `bun test tests/core/orchestrator-degrade.test.ts tests/core/orchestrator.test.ts tests/core/` → 43 pass, 0 fail, 77 expect() calls across 14 files. No regressions.
- `bun run typecheck` → clean.
- `bun run lint:file -- "src/core/orchestrator.ts" "src/cli/chat.ts" "agents/super.ts" "tests/core/orchestrator-degrade.test.ts"` → clean (one import-order fix applied by hand in `orchestrator.ts`: moved the new `../reliability/ledger.ts` type-only import above the same-level `./`-relative imports to satisfy Biome's `organizeImports`).
- `git commit` ran the pre-commit `docs-check` hook, which passed — this task threads an existing type through an already-documented subsystem (`src/core/orchestrator.ts`), it doesn't add a new one.

**Commit hygiene:** Staged only `src/core/orchestrator.ts`, `src/cli/chat.ts`, `agents/super.ts`, `tests/core/orchestrator-degrade.test.ts` by explicit path. `git status --short` showed a long list of unrelated `M` files from other in-flight SDD tasks in this slice (other `.superpowers/sdd/task-*.md` briefs/reports, `docs/ROADMAP.md`, `.remember/*`) — none were staged or touched.

**Concerns:**
- Hierarchical-crew delegate path (`buildHierarchicalOrchestrator` in `src/crew/compile.ts`, reached via `src/crew/engine.ts`/`src/cli/crew.ts`) still does not receive a `ledger`, so agent drops during a *hierarchical* crew run are not recorded in the degradation ledger. This was a deliberate scope call matching the brief's declared file list + commit-hygiene note, not an oversight. Flagging in case the slice's live-verify gate (Task 21) or a follow-up task expects crew-hierarchical coverage too — threading it would touch `src/crew/compile.ts`, `src/crew/engine.ts`, and `src/cli/crew.ts` (all currently untouched).

**Report path:** `/Users/inderjotsingh/ai/.superpowers/sdd/task-18-report.md`
