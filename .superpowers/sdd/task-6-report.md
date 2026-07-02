# Task 6 report: Migrate `chat` CLI + `runChat` to `withMcpRun`

*(This file previously held the stale Slice-15 Task-6 report — content for a
different slice/task numbering. Overwritten here with the current Slice-16
Task-6 report, which is the intended per-slice reuse of these brief/report
paths.)*

## Summary

Migrated `src/cli/chat.ts` / `src/cli/run-chat.ts` — the last of the three
CLIs (`flow`, `crew`, `chat`) — onto the `withMcpRun` helper (Task 3), so the
run dir + telemetry-init happen before the MCP mount and `mcp.mount` spans
land in `runs/<id>/spans.jsonl`. Identical migration shape to Tasks 4/5.

## Changes

### `src/cli/run-chat.ts`
- `ChatDeps`: replaced `runsRoot: string; runId: string;` with
  `run: RunHandle`.
- Import line 5 now reads
  `import { type RunHandle, writeArtifact } from '../run/run-store.ts';`
  (dropped `createRun`). The `initRunTelemetry` import (was line 6) is
  removed entirely.
- `runChat`: destructures `const { run } = deps;`; no longer calls
  `createRun`/`initRunTelemetry`/`tel.shutdown()`. **Span-name detail per the
  brief**: `withRunSpan` used to be called with `deps.runId` (the raw run-id
  string); it's now called with `run.id` (`RunHandle.id`) —
  `withRunSpan(run.id, deps.task, ...)`. Answer/gap/resource artifact
  branches are byte-identical, just now writing through the `run` handed in
  by the caller instead of one `runChat` created itself.

### `src/cli/chat.ts`
- Removed imports: `loadMcpConfig` (`../mcp/config.ts`), `mountAll`
  (`../mcp/mount.ts`), `withMcpMountSpan` (`../telemetry/spans.ts` — that
  import line had no other symbol, so the whole line is gone). Added
  `import { withMcpRun } from './with-mcp-run.ts';`.
- `main()`: the `loadMcpConfig()` → `withMcpMountSpan(mountAll)` → bare
  `try { orchestrator/runChat/console output } finally { reg.close();
  manager.unloadAll(); }` scaffolding is replaced with a single
  `withMcpRun({ runsRoot: 'runs', runId: \`run-${process.pid}\` }, async ({
  run, reg }) => { ... })` call whose body builds the orchestrator via
  `reg.forAgent(...)`, calls `runChat({ orchestrator, task, run,
  routerNumCtx, capture })`, and prints the answer/gap/resource branches
  with the exact original strings and exit-code behavior
  (`console.log`/`console.error` + `process.exitCode = 1`).
- **Manager unload-on-error parity (per the brief's explicit note)**: the
  whole `withMcpRun(...)` call is wrapped in
  `try { await withMcpRun(...) } finally { await manager.unloadAll(); }` —
  `withMcpRun`'s own `finally` already closes the registry + flushes
  telemetry, so `manager.unloadAll()` now runs strictly after the run scope
  closes (previously `reg.close()` and `manager.unloadAll()` shared one
  `finally`). If `runChat` throws, `withMcpRun`'s `finally` still tears down
  the registry/telemetry, and the outer `finally` still unloads the model
  manager, preserving the original unload-on-error guarantee.
- Everything above the old mount block (arg parsing, `maybeAutoProvision()`,
  model-manager warmup/`ensureReady`, `notify`/`announced` notice logic,
  `buildRegistry`, `createSelectHook`) is untouched.

### `tests/cli/run-chat.test.ts`
- Added imports: `createRun` (`../../src/run/run-store.ts`),
  `initRunTelemetry` (`../../src/telemetry/provider.ts`).
- All 4 cases present in the file — `run-1` (gap artifact), `run-2` (answer
  artifact), `run-span` (spans.jsonl root span), `run-nojournal` (no
  journal.jsonl) — migrated to the brief's transform: `createRun(root, id)`
  → `initRunTelemetry(run.dir)` → `try { result = await runChat({ ...,
  run }) } finally { await tel.shutdown(); }`. All existing
  `join(root, id, 'answer.txt'|'gap.txt'|'spans.jsonl'|'journal.jsonl')`
  assertions are unchanged. No cases beyond the four named in the brief were
  found in this file.
- Used `let result: Awaited<ReturnType<typeof runChat>>;` for the typed
  `let` (same pattern the biome `noImplicitAnyLet` rule required in Tasks
  4/5, applied here proactively).

### `tests/integration/run-viewer.live.test.ts`
- Added `createRun` (`../../src/run/run-store.ts`) and `initRunTelemetry`
  (`../../src/telemetry/provider.ts`) imports.
- The single `runChat({ orchestrator, task, runsRoot, runId: 'live-1' })`
  call is now wrapped: `const run = await createRun(runsRoot, 'live-1'); const
  tel = initRunTelemetry(run.dir); try { await runChat({ orchestrator, task,
  run }); } finally { await tel.shutdown(); }`, nested inside the existing
  `try { ... } finally { await close(); }` around the MCP file-tools client.
  This is the only `runChat` call in this file.

## Extra call sites found

None beyond what the brief named. Grepped the whole repo for `runChat(` —
matches are exactly: the 4 cases in `tests/cli/run-chat.test.ts`, the 1 case
in `tests/integration/run-viewer.live.test.ts`, and the 1 call site in
`src/cli/chat.ts`'s `main()`. No stragglers.

## TDD: RED → GREEN

**RED** (tests migrated first; `src/cli/run-chat.ts` still old — `ChatDeps`
still required `runsRoot`/`runId`, so `deps.runsRoot` was `undefined` when
the migrated tests passed only `run`, and old `runChat` tried
`createRun(undefined, ...)`):

```
$ bun test tests/cli/run-chat.test.ts
TypeError: The "paths[0]" property must be of type string, got undefined
 code: "ERR_INVALID_ARG_TYPE"
      at createRun (/Users/inderjotsingh/ai/src/run/run-store.ts:11:15)
      at runChat (/Users/inderjotsingh/ai/src/cli/run-chat.ts:19:21)
      at <anonymous> (/Users/inderjotsingh/ai/tests/cli/run-chat.test.ts:74:20)
(fail) runChat records a gap run and writes the gap artifact [5.10ms]
... (same failure repeated for the other 3 cases)
 0 pass
 4 fail
Ran 4 tests across 1 file. [156.00ms]
```

**GREEN** (after the `ChatDeps`/`runChat`/`main()` changes):

```
$ bun test tests/cli/run-chat.test.ts
bun test v1.3.11 (af24e281)

 4 pass
 0 fail
 9 expect() calls
Ran 4 tests across 1 file. [167.00ms]
```

## Gate results

- `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
- `bun run lint:file -- "src/cli/chat.ts" "src/cli/run-chat.ts"
  "tests/cli/run-chat.test.ts" "tests/integration/run-viewer.live.test.ts"`
  → `Checked 4 files in 4ms. No fixes applied.` — clean on the first pass,
  no formatter fixes needed.
- `bun run docs:check` (also runs as the pre-commit hook) → passed:
  `✔ docs-check: living docs present + linked; every src subsystem
  documented.` No `docs/architecture.md` change was needed — this is the
  third and final internal CLI-wiring refactor onto Task 3's
  already-documented `withMcpRun` helper; no new subsystem or change to
  `mcp.mount` ordering semantics (same reasoning as Tasks 4 and 5).
- Full suite: `bun test` → `428 pass, 2 skip, 0 fail, 923 expect() calls,
  Ran 430 tests across 129 files. [229.39s]`. The 2 skips are the
  `describe.skipIf(!ready)` Ollama-gated live tests (expected — no local
  Ollama server reachable in this environment), including
  `run-viewer.live.test.ts`'s migrated case.

## Imports removed

- `src/cli/run-chat.ts`: `createRun` (kept `writeArtifact`, added
  `RunHandle` as a type import on the same `../run/run-store.ts` line);
  `initRunTelemetry` (`../telemetry/provider.ts`) — entire import line
  removed.
- `src/cli/chat.ts`: `loadMcpConfig` (`../mcp/config.ts`) — entire import
  line removed; `mountAll` (`../mcp/mount.ts`) — entire import line removed;
  `withMcpMountSpan` (`../telemetry/spans.ts`) — entire import line removed
  (chat.ts imported nothing else from that module).

Kept as instructed: `writeArtifact`, `withRunSpan`, `setRunOutcome`.

## Commit

`31562f2` — `refactor(cli): chat/runChat use withMcpRun; ChatDeps takes
run:RunHandle (Slice 16 Task 6)` (4 files changed, 107 insertions(+), 89
deletions(-) — only `src/cli/chat.ts`, `src/cli/run-chat.ts`,
`tests/cli/run-chat.test.ts`, `tests/integration/run-viewer.live.test.ts`
staged/committed; other concurrently-modified repo files, e.g.
`.superpowers/sdd/*`, `.remember/*`, were left untouched/unstaged for this
task).

## Concerns / notes

None functional. This closes out the three-CLI migration set (`flow`,
`crew`, `chat`) onto `withMcpRun`; all three now share the identical
run-dir → telemetry-init → mount → body → close/shutdown ordering, fixing
the `mcp.mount` telemetry-ordering bug uniformly across the CLI surface.
