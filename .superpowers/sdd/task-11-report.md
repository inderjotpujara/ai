# Task 11 report: CLI (`bun run memory …`)

**Status:** COMPLETE

**Commit:** cf4ce85 — `feat(memory): bun run memory CLI (ingest/recall/stats/reindex)`

**Test summary:** `tests/cli/memory.test.ts` 3 pass / 0 fail; full suite 248 pass / 16 skip / 0 fail (264 tests across 88 files, 50.25s)

## Implemented

- `src/cli/memory.ts` — exports `runMemoryCli(argv, deps): Promise<number>` plus a
  guarded `if (import.meta.main)` real entrypoint, mirroring `crew.ts`/`flow.ts`.
- `package.json` — added `"memory": "bun run src/cli/memory.ts"`.
- `tests/cli/memory.test.ts` — 3 routing tests against a fake `MemoryStore`
  (recall→0, stats routes to `store.stats`, unknown command→non-zero).

### Command routing (`runMemoryCli`)
- `ingest <path> [--space] [--ns]` → `store.ingest(path, { space, namespace, at: Date.now() })`
- `recall <query...> [--space] [--ns] [--top]` → `store.recall(query, { space, namespace, topK })`, prints JSON
- `stats` → `store.stats()`, prints JSON
- `reindex <space> <newEmbedModel>` → `store.reindex(space, newEmbedModel)`
- unknown/missing command or missing required positional args → prints usage, returns `1`
- `finally { store.close(); }` always runs regardless of outcome/branch

Flags are parsed by a small local `parseFlags` (no external arg-parsing dep), consistent
with the rest of the CLI surface (crew.ts/flow.ts also hand-roll `process.argv` parsing).

### Real store wiring (`makeRealStore`, behind `deps.makeStore`)
This is the piece the task brief flagged as needing care — there was no existing
consumer of `makeEmbedder` to copy from, so I derived the wiring from its type
signature (`src/memory/embed.ts`) plus how `crew.ts`/`flow.ts`/`select-runtime.ts`
build their runtime deps:

- `createModelManager()` (from `src/resource/model-manager.ts`) → gives `ensureReady`.
  I did **not** use `createSelectionRuntime()` (the helper `crew.ts`/`flow.ts` share) —
  that helper additionally builds an offline model *registry* + a `select-hook` for
  live agent-delegation model selection, none of which the embedder needs. The
  embedder only needs `ensureReady` (to load the weights-only embed model) and a
  `RuntimeControl.embed(model, texts)` implementation, so a bare `createModelManager()`
  plus `runtimeFor(ProviderKind.Ollama).control` is the minimal correct wiring.
- `runtimeFor(ProviderKind.Ollama).control` (from `src/runtime/registry.ts`) → the
  `RuntimeControl` whose `.embed()` Ollama implements via `embedMany` (`src/runtime/ollama.ts`).
- `makeEmbedder({ ensureReady: (decl) => manager.ensureReady(decl), control, model })`
  from Task 4 (`src/memory/embed.ts`) → produces `{ embed(texts): Promise<number[][]> }`,
  which ensures the weights-only embed model is loaded (via the manager, respecting the
  live RAM budget) before calling `control.embed`.
- Wired into Task 9's `createMemoryStore(config, deps)` as:
  `{ embedTexts: embedder.embed, embedQuery: async t => (await embedder.embed([t]))[0], probe: probeEmbedder }`.
- Embed model resolution order: `--embed` flag → `AGENT_MEMORY_EMBED_MODEL` env → the
  Task-4/Task-9 default `qwen3-embedding:0.6b` (env is fallback-only per repo convention;
  `defineMemory` in `src/memory/define.ts` re-applies the same fallback independently for
  `MemoryConfig.path`).
- `Date.now()` is called exactly once, at the CLI boundary, for `ingest`'s `at:` field —
  not inside `src/memory/*` engine core, per the brief's instruction.

### Lifecycle (mirrors `flow.ts`)
`main()` calls `createRun('runs', 'memory-${process.pid}')` then `initRunTelemetry(run.dir)`,
runs `runMemoryCli` inside `try`, sets `process.exitCode`, and `finally`s `tel.shutdown()`.
The real entrypoint is guarded by `if (import.meta.main)`.

## TDD RED/GREEN
- RED: wrote `tests/cli/memory.test.ts` (3 tests) against a not-yet-existing
  `src/cli/memory.ts` → `bun test tests/cli/memory.test.ts` failed with
  `Cannot find module '../../src/cli/memory.ts'` (1 error, 0 pass).
- GREEN: implemented `src/cli/memory.ts` → all 3 tests pass
  (`3 pass / 0 fail / 5 expect() calls`).

## Verification run
- `bun test tests/cli/memory.test.ts` → 3 pass, 0 fail.
- `bun run typecheck` → clean (`tsc --noEmit`, no errors).
- `bun run lint:file -- src/cli/memory.ts tests/cli/memory.test.ts` → initially flagged
  3 formatting issues (multiline `console.error` wrapping + import order in the test file);
  fixed via `bunx biome check --write` on both files, then re-ran lint clean. Also removed
  a dead `export { MemoryKind }` re-export left over from an early draft (unused, not
  requested by the brief) before final lint/typecheck/test pass.
- `bun run docs:check` → passes (`src/cli` is an already-documented subsystem; no new
  subsystem introduced by this task).
- Full suite: `bun test` → **248 pass, 16 skip, 0 fail, 496 expect() calls, across 88 files** (50.25s).

## Files touched
- `src/cli/memory.ts` (new)
- `tests/cli/memory.test.ts` (new)
- `package.json` (added `"memory"` script)

## Self-review
- No `any` used anywhere in the new file; `MemoryStore` type comes straight from
  `src/memory/store.ts`'s `ReturnType<typeof createMemoryStore>`.
- No stray `console.log` — every `console.log`/`console.error` call is intentional
  CLI output (usage errors to stderr, results to stdout), same convention as
  `crew.ts`/`flow.ts`.
- `deps.makeStore` is the only seam the unit tests use; the default wiring
  (`makeRealStore`) is only invoked from `main()`, which requires `import.meta.main`,
  so no Ollama/model-manager code runs during `bun test`.
- Matched existing CLI conventions: hand-rolled arg parsing (no new dependency),
  `finally { store.close() }` / `finally { await tel.shutdown() }` symmetric with
  crew.ts/flow.ts's nested `finally` chains for tool servers.

## Concerns
- `reindex` does not accept `--embed` (it takes the new model as a positional arg per
  the brief's `reindex <space> <newEmbedModel>` signature), so the `--embed` flag only
  affects `ingest`/`recall`'s embedder selection (and thus which embedder backs a
  *newly created* space, since `ensureSpace` in `store.ts` locks a space's embedder at
  creation time). This matches Task 9's documented reindex contract, not a gap I
  introduced.

## Fix (post-review finding)

**Status:** APPLIED

**Commit:** cc27287 — `fix(memory): unload embedder Model Manager in memory CLI finally`

The initial task-11 code flagged a resource leak: `createModelManager()` constructed in
`makeRealStore` was never unloaded, leaving the embedder model resident after CLI exit
(unlike `flow.ts`/`crew.ts` which call `selection.close() → manager.unloadAll()` in their
finally blocks).

**Changes:**
- Refactored `makeRealStore(flags)` to return `{ store, manager }` instead of just `store`.
- Updated `main()` to capture the manager and call `await manager.unloadAll()` in the finally block,
  alongside `tel.shutdown()`, mirroring the pattern in `select-runtime.ts`.
- The unit test (`runMemoryCli` with injected fake store) remains completely unchanged because
  `MemoryCliDeps.makeStore` signature stays the same (returns `MemoryStore`), and the manager
  teardown lives only on the real `main()` path, not in the testable `runMemoryCli` function.

**Verification:**
- `bun test tests/cli/memory.test.ts` → 3 pass / 0 fail (unchanged).
- `bun run typecheck` → clean.
- `bun run lint:file -- src/cli/memory.ts` → clean.
- Full suite: `bun test` → **248 pass, 16 skip, 0 fail, 496 expect() calls, across 88 files** (53.44s).
