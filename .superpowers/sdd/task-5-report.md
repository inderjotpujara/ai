# Task 5 report: Migrate `crew` CLI to `withMcpRun`

## Summary

Migrated `src/cli/crew.ts` so `runCrewCli` no longer creates the run dir or
inits/tears down telemetry — it now receives an already-created
`run: RunHandle` via `CrewCliDeps`. `main()` is rewired to call `withMcpRun`
(Task 3), which owns the run-dir + telemetry-init + MCP-mount ordering so
`mcp.mount` spans land in `runs/<id>/spans.jsonl`. This is the identical
migration Task 4 applied to `flow`.

## Changes

### `src/cli/crew.ts`
- `CrewCliDeps`: replaced `runsRoot: string; runId: string;` with
  `run: RunHandle`.
- Import line (`../run/run-store.ts`) now brings in `RunHandle` (type) +
  `writeArtifact` only.
- `runCrewCli`: destructures `deps.run` directly; no longer calls
  `createRun`/`initRunTelemetry`/`tel.shutdown()`. Body (verify-flag
  splicing, `runCrew` call, artifact writes on done/unverified/failed) is
  otherwise byte-identical.
- `main()`: replaced the manual `loadMcpConfig` → `withMcpMountSpan(mountAll)`
  → try/finally `reg.close()` scaffolding with a single
  `await withMcpRun({ runsRoot: 'runs', runId: \`crew-${process.pid}\` }, async ({ run, reg }) => { ... })`
  call. Inner body (selection runtime, `tools = reg.merged`, verify runtime,
  `runCrewCli` call, console output, exit codes, nested finally blocks) is
  unchanged in behavior — only the closing braces/finally nesting changed to
  match the new callback shape.

### `tests/cli/crew.test.ts`
- Added imports: `createRun` (`../../src/run/run-store.ts`),
  `initRunTelemetry` (`../../src/telemetry/provider.ts`), `type CrewOutcome`
  (`../../src/crew/types.ts`, needed to type `let outcome` — biome's
  `noImplicitAnyLet` rejected an untyped `let outcome;`, same issue Task 4
  hit).
- All 3 cases (r1, r2, r3 — the brief's full enumeration, no extras found in
  this file) now do:
  ```ts
  const run = await createRun(runsRoot, 'r1');
  const tel = initRunTelemetry(run.dir);
  let outcome: CrewOutcome;
  try {
    outcome = await runCrewCli({ def, input, run, tools /*, ...*/ });
  } finally {
    await tel.shutdown();
  }
  ```
  All existing `spans.jsonl` / `result.txt` / `unverified.txt` path
  assertions are unchanged.

### `tests/integration/crew.live.test.ts`
- Added the same `createRun`/`initRunTelemetry` imports and applied the
  identical transform to the single `runId: 'live'` call.

## Extra test cases found

None. `tests/cli/crew.test.ts` has exactly r1/r2/r3 as the brief describes;
`tests/integration/crew.live.test.ts` has exactly one `runCrewCli` call
(`runId: 'live'`). No stragglers to migrate beyond what the brief specified.

## TDD: RED → GREEN

**RED** (test files migrated first, `src/cli/crew.ts` still old — `CrewCliDeps`
still required `runsRoot`/`runId`, so the migrated tests' `run: RunHandle`
field was ignored and old `runCrewCli` tried `createRun(deps.runsRoot, ...)`
with `deps.runsRoot === undefined`):

```
$ bun test tests/cli/crew.test.ts
TypeError: The "paths[0]" property must be of type string, got undefined
 code: "ERR_INVALID_ARG_TYPE"
      at createRun (/Users/inderjotsingh/ai/src/run/run-store.ts:11:15)
      at runCrewCli (/Users/inderjotsingh/ai/src/cli/crew.ts:29:21)
      ...
 0 pass
 3 fail
Ran 3 tests across 1 file. [220.00ms]
```

**GREEN** (after the `CrewCliDeps`/`runCrewCli`/`main` changes):

```
$ bun test tests/cli/crew.test.ts
bun test v1.3.11 (af24e281)

 3 pass
 0 fail
 7 expect() calls
Ran 3 tests across 1 file. [191.00ms]
```

## Gate results

- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- "src/cli/crew.ts" "tests/cli/crew.test.ts" "tests/integration/crew.live.test.ts"`
  → initially flagged one formatter diff in `tests/cli/crew.test.ts` (the
  consolidated `import { type CrewDef, type CrewOutcome, CrewProcess } from ...`
  line exceeded print width and needed multi-line wrapping); fixed with
  `bunx biome check --write tests/cli/crew.test.ts`. Final run: clean
  (`Checked 3 files in 4ms. No fixes applied.`).
- Full suite: `bun test` → `428 pass, 2 skip, 0 fail, 923 expect() calls,
  Ran 430 tests across 129 files. [241.18s]`. The 2 skips are the
  `describe.skipIf(!ready)` Ollama-gated live tests (expected — no local
  Ollama server reachable in this environment).
- `bun run docs:check` (pre-commit hook, also run standalone) → passed:
  `✔ docs-check: living docs present + linked; every src subsystem documented.`
  No `docs/architecture.md` change was needed — this is an internal
  CLI-wiring refactor onto Task 3's already-documented `withMcpRun` helper,
  not a new subsystem or a change to `mcp.mount` ordering semantics (same
  reasoning as Task 4).

## Imports removed from `src/cli/crew.ts`

- `loadMcpConfig` (from `../mcp/config.ts`) — entire import line removed.
- `mountAll` (from `../mcp/mount.ts`) — entire import line removed (crew.ts
  had no other symbol from that module, unlike flow.ts's `warnUnknownAgents`).
- `withMcpMountSpan` (from `../telemetry/spans.ts`) — entire import line
  removed (crew.ts imported nothing else from that module).
- `initRunTelemetry` (from `../telemetry/provider.ts`) — entire import line
  removed.
- `createRun` (from `../run/run-store.ts`) — kept `writeArtifact`, added
  `RunHandle` as a type import on the same line.

Kept as instructed: `writeArtifact`.

## Commit

`2972253` — `refactor(cli): crew uses withMcpRun; runCrewCli takes run:RunHandle (Slice 16 Task 5)`
(3 files changed, 139 insertions, 124 deletions — only `src/cli/crew.ts`,
`tests/cli/crew.test.ts`, `tests/integration/crew.live.test.ts` staged/
committed; other concurrently-modified repo files, e.g. `.superpowers/sdd/*`,
`.remember/*`, were left untouched/unstaged for this task).

## Concerns / notes

None functional. No deviations from the brief were required beyond the
formatter auto-wrap noted above. Note: this same filename previously held a
stale Slice-15 report (for a different task numbering) — it has been
overwritten with this Task 5 / Slice 16 report.
