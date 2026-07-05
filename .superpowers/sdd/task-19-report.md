# Task 19 report: Crew engine threads the degradation ledger (Slice 21)

## Status: DONE

## What changed

- `src/crew/engine.ts`:
  - `CrewDeps` gains `ledger?: DegradationLedger`.
  - Sequential path: `defaultRunAgentStep(crewAgentMap(...), deps.onBeforeDelegate, deps.ledger)`.
  - Hierarchical path: `buildHierarchicalOrchestrator(def, deps.onBeforeDelegate, deps.ledger)`.
- `src/crew/compile.ts`:
  - `buildHierarchicalOrchestrator` gains a third optional `ledger?: DegradationLedger` param, forwarded into `createOrchestrator({ ..., ledger })` — this closes the hierarchical gap Task 18 flagged (Task 18 only wired the standalone orchestrator entry point, not the crew's hierarchical builder).
- `src/workflow/run-step.ts`:
  - `defaultRunAgentStep` gains a third optional `ledger?: DegradationLedger` param, forwarded into `runGuardedAgent(agent, task, onBeforeDelegate, undefined, ledger)` (abortSignal stays `undefined` — this path has none available, matching the existing call before this change).
- `src/cli/crew.ts`:
  - `CrewCliDeps` gains `ledger?: DegradationLedger`.
  - `runCrewCli` forwards `deps.ledger` into `runCrew(...)`.
  - `main()` passes the `ledger` already destructured from `withMcpRun`'s callback (`{ run, reg, ledger }`) into `runCrewCli({ ..., ledger })`.

Both delegation paths (sequential agent-step and hierarchical orchestrator) now thread the ledger through to `runGuardedAgent`, where drops/circuit-opens are recorded (per Task 15/18's `runGuardedAgent`/`createOrchestrator` contract). All new params are optional; no existing caller signature changes semantics.

## Test

- `tests/crew/crew-degrade.test.ts` (new): builds a minimal sequential `CrewDef` (1 member, 1 task), passes `ledger: createLedger()` and a stub `runAgentStep` that succeeds, in `CrewDeps`. Asserts `outcome.kind === 'done'` and `ledger.events` stays empty on a clean run (Step 1 scope per brief; substantive drop-recording is exercised live in Task 21).
- Confirmed TDD red state first: before the `CrewDeps.ledger` field existed, `bun run typecheck` failed with `TS2353: Object literal may only specify known properties, and 'ledger' does not exist in type 'CrewDeps'` on the new test file (bun's runtime test itself still passed since JS doesn't enforce excess-property checks at runtime — the type-level check was the actual red signal, consistent with the interface-only nature of this task).

## Verify results

- `bun test tests/crew/crew-degrade.test.ts tests/crew/` → 22 pass, 0 fail.
- `bun test tests/workflow/ tests/crew/ tests/core/` (broader regression sweep since `run-step.ts` changed) → 87 pass, 0 fail.
- `bun run typecheck` → clean.
- `bun run lint:file -- "src/crew/engine.ts" "src/crew/compile.ts" "src/cli/crew.ts" "src/workflow/run-step.ts" "tests/crew/crew-degrade.test.ts"` → clean, no fixes needed.

## Commit

- `ba0490f` — `feat(crew): thread degradation ledger through crew delegation` (5 files changed: `src/cli/crew.ts`, `src/crew/compile.ts`, `src/crew/engine.ts`, `src/workflow/run-step.ts`, `tests/crew/crew-degrade.test.ts`; unrelated working-tree changes left untouched/unstaged per commit-hygiene instruction).

## Concerns / deviations

None. `defaultRunAgentStep` was confirmed to live in `src/workflow/run-step.ts` (re-exported from `src/workflow/engine.ts`), matching the brief's expectation. Both the sequential and hierarchical crew paths are wired; the hierarchical wiring required a small addition to `buildHierarchicalOrchestrator`'s signature in `src/crew/compile.ts`, which was anticipated in the brief's Step 3 note but not explicitly listed under "Files" — flagging for visibility, not as a deviation of substance.
