# Task 9 Report: `MemoryStore` facade

## Implemented

- `src/memory/store.ts` — `createMemoryStore(config, deps)` returning a `MemoryStore` facade:
  `remember`, `ingest`, `recall`, `reindex`, `stats`, `close`.
- `tests/memory/store.test.ts` — the brief's 2 tests, ported from the brief's `vitest` sample to
  `bun:test` (matching the existing convention in `tests/memory/sqlite-store.test.ts` etc.), using
  `/tmp/memstore-test` with `rmSync` cleanup in `afterEach`.

Implementation follows the brief's Step 3 code sample, composing:
- `defineMemory` (Task 1) to resolve `{ path, embedModel }` and `MemoryError` for the `reindex`
  unknown-space guard.
- `chunk` (Task 5), called with `capTokens: meta.chunkCapTokens` — i.e. the **space's recorded**
  chunk cap, not a config default — plus the injected `embedTexts` for semantic chunking.
- `LanceStore` (Task 7) for the vector tier (`openOrCreateTable`, `upsert`, `count`, `dropTable`)
  and `SqliteStore` (Task 6) for the structured tier (`getSpace`, `createSpace`, `listSpaces`,
  `seenDoc`, `recordDoc`).
- `retrieve` + `Reranker` (Task 8) for `recall`.
- `withMemoryIngestSpan` (Task 3) wrapping the `ingest` body (span covers embed + write, not the
  dedupe short-circuit — matches Task 3's ingest span shape).
- `deps = { embedTexts, embedQuery, probe, reranker? }` — all injected, no Ollama calls in the
  module or its tests.

One deliberate deviation from the brief's literal code: `vectors[i]!` (non-null assertion) was
changed to `vectors[i] ?? []` because the project's Biome config forbids
`lint/style/noNonNullAssertion`. `vectors` and `chunks` are always the same length (guaranteed by
`deps.embedTexts` mapping 1:1 over `chunks.map((c) => c.text)`), so the `?? []` fallback is
unreachable in practice; it exists only to satisfy the type checker without the banned assertion.

Correctness requirements from the task description, verified against the code:

- **Space embedder is authoritative:** `ensureSpace` calls `sql.getSpace(space)` first and returns
  the existing `SpaceMeta` immediately if found — `cfg.embedModel` (the store's configured default)
  is only consulted via `deps.probe(cfg.embedModel)` in the `else` branch, i.e. only when the space
  doesn't exist yet. An existing space's recorded `embedModel`/`embedDim`/`chunkCapTokens` are never
  overwritten by a later `remember`/`ingest` call with a different global config. Covered by test 2.
- **`recall` on a missing space returns `[]`:** `sql.getSpace(opts.space ?? DEFAULT_SPACE)` is
  checked before calling `retrieve`; if absent, returns `[]` directly (abstention, no throw).
- **`ingest` dedupes by content hash:** SHA-256 of file contents is checked via `sql.seenDoc(path,
  hash)` before any chunk/embed/write work; returns `{ chunks: 0, skipped: true }` on a hit.
- **`reindex(space, newEmbedModel)`:** throws `MemoryError` if `sql.getSpace(space)` is undefined;
  otherwise `lance.dropTable(space).catch(() => {})` (tolerates a missing/never-created table, per
  Task 7's note that `dropTable`/`count` throw on a missing table) then re-creates the sqlite space
  row and the LanceDB table under the new embedder's probed dim.
- **No `Date.now()` in the module:** all timestamps come through the `at: number` parameter on
  `remember`/`ingest` (`reindex` doesn't need one — it only rewrites embedder metadata). Grepped the
  file to confirm no `Date.now()` call exists.

## TDD RED/GREEN

- RED: `bun test tests/memory/store.test.ts` before creating `src/memory/store.ts` failed with
  `Cannot find module '../../src/memory/store.ts'` (1 fail, 1 error), as expected.
- GREEN: after writing `src/memory/store.ts`, `bun test tests/memory/store.test.ts` → `2 pass, 0
  fail, 2 expect() calls`.

## Verification run

- `bun test tests/memory/store.test.ts` → 2 pass / 0 fail.
- `bun run typecheck` → clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/memory/store.ts tests/memory/store.test.ts` → clean after Biome
  auto-fix (import ordering + long-line wrapping only; one real finding, the non-null-assertion
  rule, fixed by hand as described above).
- Full suite: `bun test` → **240 pass, 16 skip, 0 fail, 483 expect() calls, 256 tests across 86
  files.**

## Files touched

- `/Users/inderjotsingh/ai/src/memory/store.ts` (new)
- `/Users/inderjotsingh/ai/tests/memory/store.test.ts` (new)

## Self-review

- Signatures match the brief's `StoreDeps`/facade shape exactly, except the task-description prose
  mentioned an `ensureReady` dep that doesn't appear in the brief's actual code sample or tests —
  went with the code sample (which is also what the tests exercise) as authoritative; no
  `ensureReady` was introduced since nothing calls it and it's not part of `StoreDeps`.
- `writeChunks` is shared by both `remember` and `ingest`, keeping the chunk→embed→upsert pipeline
  in one place; `ensureSpace` is likewise shared, keeping the authority rule enforced in exactly one
  spot rather than duplicated per call site.
- `recall`'s reranker plumbing (`opts.rerank ? deps.reranker : undefined`) matches Task 8's
  `retrieve` contract, which itself gates reranking on `opts.rerank && deps.reranker`.
- Did not touch `docs/architecture.md`/README/ROADMAP for this task: Slice 12 already has a stub
  entry (`46d37a6 docs(arch): stub Memory/RAG §11 (Slice 12 in progress) to unblock docs gate`), and
  prior in-slice task commits (Tasks 4–8) likewise landed without per-task architecture-doc edits —
  the full living-doc update is expected at slice completion per the project's documentation
  hard-line rule, not on every intermediate task commit within an in-progress slice.

## Concerns

- None blocking. Two minor observations for the slice-completion review:
  1. The `vectors[i] ?? []` fallback masks a would-be length mismatch between `chunks` and
     `vectors` with a silent empty vector rather than a loud failure — in practice this can't
     happen given `writeChunks`'s own call pattern, but if `deps.embedTexts` is ever swapped for an
     implementation that can legitimately return a short array, this would silently corrupt data
     instead of throwing. Worth a follow-up assertion if that risk becomes real.
  2. `reindex` does not re-ingest existing documents/memories after dropping the table — this is
     called out in the code comment as deliberate ("re-ingest is the caller's job"), but it also
     means `stats()` will show 0 for a space until it's fully backfilled, and the sqlite
     `documents` dedupe table stays stale (no rows cleared for it). Worth confirming this is the
     intended CLI/operator workflow when the CLI wraps `reindex`.

## Fix

Both concerns above were confirmed as real bugs and fixed.

**Bug 1 — dedupe manifest was global, not per-space.** The `documents` table had
`source TEXT PRIMARY KEY`, no `space` column, so `seenDoc`/`recordDoc` keyed only on file path.
Two named spaces ingesting the same source path collided: the second space's `ingest` call saw
`seenDoc(path, hash) === true` (written by the first space) and was silently skipped, leaving the
second space empty. This directly broke the named-spaces feature's isolation guarantee.

**Bug 2 — `reindex` didn't clear the manifest.** `reindex` dropped and recreated the LanceDB
vector table but left the sqlite `documents` rows in place. A subsequent re-ingest of the same
files after a reindex saw `seenDoc` return `true` (stale hash match) and skipped every file,
leaving the reindexed space permanently empty until a manual DB edit.

### Changes

- `src/memory/sqlite-store.ts`:
  - `documents` table schema changed to `(space TEXT NOT NULL, source TEXT NOT NULL, hash TEXT
    NOT NULL, chunks INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (space, source))` — plain
    `CREATE TABLE IF NOT EXISTS` (no migration; dev DBs are git-ignored/disposable, tests use
    fresh temp dirs).
  - `seenDoc(space, source, hash)` and `recordDoc(space, source, hash, chunks, at)` now take
    `space` as the first parameter; both query/insert with `WHERE space = ? AND source = ?` /
    the new composite key.
  - Added `clearDocsForSpace(space): void` — `DELETE FROM documents WHERE space = ?`.
- `src/memory/store.ts`:
  - `ingest` now calls `sql.seenDoc(space, path, hash)` and `sql.recordDoc(space, path, hash, n,
    o.at)` (space threaded through, argument order matches the new signature).
  - `reindex` calls `sql.clearDocsForSpace(space)` right after `lance.dropTable(space)`, so a
    subsequent re-ingest into the freshly reindexed space is never skipped.
  - Also fixed the previously-flagged `vectors[i] ?? []` silent-corruption risk in `writeChunks`:
    now throws `MemoryError('embedTexts returned N vectors for M chunks')` up front if the
    lengths mismatch, then builds each record with a per-index guard (`const v = vectors[i]; if
    (!v) throw new MemoryError(...)`) instead of masking a mismatch with an empty vector.
- `tests/memory/sqlite-store.test.ts`:
  - Updated the existing dedupe test to pass `space` ('default') to `seenDoc`/`recordDoc`.
  - Added `doc dedupe is space-scoped (cross-space isolation)`: `recordDoc('spaceB','f','h',...)`
    then `seenDoc('spaceA','f','h')` is `false` (same source+hash, different space → not seen).
  - Added a `clearDocsForSpace` test: records docs in two spaces, clears one, confirms only that
    space's row is gone.
- `tests/memory/store.test.ts`:
  - Kept the two existing tests green (no signature changes visible at the `store.ts` public API
    level — `space` threading is internal).
  - Added `reindex clears the dedupe manifest so re-ingest is not skipped`: ingests a real file
    into a space, reindexes it, re-ingests the same file, and asserts `result.skipped === false`.

### Commands run

- `bun test tests/memory/sqlite-store.test.ts tests/memory/store.test.ts` →
  `7 pass, 0 fail, 13 expect() calls, Ran 7 tests across 2 files.`
- `bun run typecheck` → `tsc --noEmit`, no output (clean).
- `bun run lint:file -- src/memory/sqlite-store.ts src/memory/store.ts` →
  `Checked 2 files in 27ms. No fixes applied.` (clean)
  - Also ran `bun run lint:file -- tests/memory/sqlite-store.test.ts tests/memory/store.test.ts`
    after adding the new tests; Biome flagged formatting (one pre-existing line plus the new
    test blocks) and was fixed via `bunx biome check --write` on both test files. Re-run after
    fix: `Checked 4 files in 3ms. No fixes applied.` (clean)
- `bun test` (full suite) → `243 pass, 16 skip, 0 fail, 488 expect() calls, Ran 259 tests across
  86 files.`
- `bun run typecheck` (re-run after full suite) → clean, no output.
- Commit: `c0f7e34 fix(memory): space-scope the document dedupe manifest + clear on reindex` on
  branch `slice-12-memory-rag` (pre-commit hook `bun run scripts/docs-check.ts` passed:
  "✔ docs-check: living docs present + linked; every src subsystem documented.").
