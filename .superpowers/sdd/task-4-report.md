# Task 4 report: Migrate `flow` CLI to `withMcpRun`

## Summary

Migrated `src/cli/flow.ts` so `runFlow` no longer creates the run dir or
inits/tears down telemetry — it now receives an already-created
`run: RunHandle` via `FlowDeps`. `main()` is rewired to call `withMcpRun`
(from Task 3), which owns the run-dir + telemetry-init + MCP-mount ordering
so `mcp.mount` spans land in `runs/<id>/spans.jsonl`.

## Changes

### `src/cli/flow.ts`
- `FlowDeps`: replaced `runsRoot: string; runId: string;` with `run: RunHandle`.
- Added `RunHandle` to the `run-store` import; removed `createRun` (no longer
  used here — `withMcpRun` owns it).
- Removed now-unused imports: `loadMcpConfig`, `mountAll` (from `../mcp/mount.ts`,
  kept `warnUnknownAgents`), `withMcpMountSpan` (from `../telemetry/spans.ts`),
  `initRunTelemetry` (from `../telemetry/provider.ts`).
- Added import: `withMcpRun` from `./with-mcp-run.ts`.
- `runFlow`: destructures `deps.run` directly; no longer calls `createRun`/
  `initRunTelemetry`/`tel.shutdown()`. Body (workflow-span wrapping,
  artifact writes on done/unverified/failed) is otherwise unchanged.
- `main()`: replaced the manual `loadMcpConfig` → `withMcpMountSpan(mountAll)`
  → try/finally `reg.close()` scaffolding with a single
  `await withMcpRun({ runsRoot: 'runs', runId: \`flow-${process.pid}\` }, async ({ run, reg, config }) => { ... })`
  call. Inner body (selection runtime, agent wiring, `warnUnknownAgents`,
  verify runtime, `runFlow` call, console output, exit codes) is byte-identical
  in behavior — only the closing braces/finally nesting changed to match the
  new callback shape.

### `tests/cli/flow.test.ts`
- Added imports: `createRun` (`../../src/run/run-store.ts`), `initRunTelemetry`
  (`../../src/telemetry/provider.ts`), `type WorkflowOutcome`
  (`../../src/workflow/types.ts`, needed to type `let outcome` — biome's
  `noImplicitAnyLet` rejected an untyped `let outcome;`).
- All 4 cases (r1, r2, r3, r4 — the brief only called out r1-r3, but the file
  actually has a 4th case for the grounded/verify-pass scenario, migrated for
  consistency) now do:
  ```ts
  const run = await createRun(runsRoot, 'r1');
  const tel = initRunTelemetry(run.dir);
  let outcome: WorkflowOutcome;
  try {
    outcome = await runFlow({ def, input, run, agents, tools /*, ...*/ });
  } finally {
    await tel.shutdown();
  }
  ```
  All existing `spans.jsonl` / `result.txt` / `failed.txt` / `unverified.txt`
  path assertions are unchanged.

### `tests/integration/workflow.live.test.ts`
- Added the same `createRun`/`initRunTelemetry`/`WorkflowOutcome` imports and
  applied the identical transform to the single `runId: 'live'` call.

## TDD: RED → GREEN

**RED** (test files migrated first, `src/cli/flow.ts` still old):

```
$ bun test tests/cli/flow.test.ts
TypeError: The "paths[0]" property must be of type string, got undefined
 code: "ERR_INVALID_ARG_TYPE"
      at createRun (/Users/inderjotsingh/ai/src/run/run-store.ts:11:15)
      at runFlow (/Users/inderjotsingh/ai/src/cli/flow.ts:74:21)
      ...
 0 pass
 4 fail
Ran 4 tests across 1 file. [230.00ms]
```
(Old `runFlow` still destructured `deps.runsRoot`/`deps.runId`, which the
migrated tests no longer pass — confirms the test exercised the pre-change
signature and failed for the expected reason.)

**GREEN** (after the `FlowDeps`/`runFlow`/`main` changes):

```
$ bun test tests/cli/flow.test.ts
bun test v1.3.11 (af24e281)

 4 pass
 0 fail
 10 expect() calls
Ran 4 tests across 1 file. [203.00ms]
```

## Gate results

- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- "src/cli/flow.ts" "tests/cli/flow.test.ts" "tests/integration/workflow.live.test.ts"`
  → initially flagged: (a) formatter diffs in `flow.ts` (fixed with
  `bunx biome check --write src/cli/flow.ts`), (b) `noImplicitAnyLet` on the
  5 `let outcome;` declarations across both test files (fixed by typing them
  `let outcome: WorkflowOutcome;` and importing the type). Final run:
  `Checked 3 files in 5ms. No fixes applied.` — clean.
- Full suite: `bun test` → `428 pass, 2 skip, 0 fail, 923 expect() calls,
  Ran 430 tests across 129 files. [259.75s]`. The 2 skips are the
  `describe.skipIf(!ready)` Ollama-gated live tests (expected — no local
  Ollama server reachable in this environment).
- `bun run docs:check` (pre-commit hook) → passed:
  `✔ docs-check: living docs present + linked; every src subsystem documented.`
  No `docs/architecture.md` change was needed for this task — it's an internal
  CLI-wiring refactor onto Task 3's already-documented `withMcpRun` helper,
  not a new subsystem or a change to `mcp.mount` ordering semantics.

## Imports removed from `src/cli/flow.ts`

- `loadMcpConfig` (from `../mcp/config.ts`) — entire import line removed.
- `mountAll` (from `../mcp/mount.ts`) — kept `warnUnknownAgents` from the
  same module.
- `withMcpMountSpan` (from `../telemetry/spans.ts`) — kept `ATTR`,
  `annotateStep`, `withWorkflowSpan`.
- `initRunTelemetry` (from `../telemetry/provider.ts`) — entire import line
  removed.
- `createRun` (from `../run/run-store.ts`) — kept `writeArtifact`, added
  `RunHandle` as a type import.

Kept as instructed: `warnUnknownAgents`, `writeArtifact`.

## Commit

`851ac66` — `refactor(cli): flow uses withMcpRun; runFlow takes run:RunHandle (Slice 16 Task 4)`
(3 files changed, 159 insertions, 145 deletions — only
`src/cli/flow.ts`, `tests/cli/flow.test.ts`,
`tests/integration/workflow.live.test.ts` staged/committed; other
concurrently-modified repo files, e.g. `.superpowers/sdd/*`, `.remember/*`,
were left untouched/unstaged for this task).

## Concerns / notes

- None functional. One deviation from the brief worth flagging: the brief's
  Step 1 text only mentions migrating r1/r2/r3 in `tests/cli/flow.test.ts`,
  but the file has a 4th case (`r4`, the grounded verify-pass scenario). I
  applied the identical transform to it too, since leaving it on the old
  `runsRoot`/`runId` signature would have broken the build.
