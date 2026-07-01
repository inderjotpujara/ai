# Task 7 report — LanceDB native-load smoke test + vector store adapter

(Note: this filename previously held a stale report from an unrelated earlier
Slice-11 task that happened to reuse the same path. This report replaces it
and documents Slice 12 Task 7 only.)

## Summary

Status: **DONE**. LanceDB's native `.node` binary loads cleanly under Bun on
Apple Silicon (arm64). This is a clean go for the rest of Slice 12.

## What was implemented

- **`package.json`**: added `@lancedb/lancedb@0.30.0` as a direct dependency
  via `bun add @lancedb/lancedb@0.30.0`. Installed exactly at pinned version
  (no range). `bun.lock` updated accordingly. Optional platform package
  `@lancedb/lancedb-darwin-arm64@0.30.0` resolved and installed with the
  `.node` binary present at
  `node_modules/@lancedb/lancedb-darwin-arm64/lancedb.darwin-arm64.node`.
- **`src/memory/lancedb-store.ts`** (new): `LanceStore` class implementing
  the five required methods — `openOrCreateTable`, `upsert`, `hybridSearch`,
  `count`, `dropTable` — plus a private lazy `db()` connection accessor.
- **`tests/memory/lancedb-smoke.test.ts`** (new): TDD smoke test using
  `bun:test` (confirmed as the repo convention — 82 of 83 existing test
  files use `bun:test`; only `tests/memory/sqlite-store.test.ts`, from an
  earlier task on this branch, uses `vitest` and is already broken/orphaned
  — pre-existing, not touched by this task, noted below).

**Bundler check**: confirmed no esbuild/rollup/vite/tsup config exists
anywhere in the repo root, and there is no `build` script in `package.json`
— TS runs directly via `bun`/`tsc --noEmit`. No "external" tweak was
needed anywhere for the native module.

## Native-load result: PASS

No native binding / `.node` load errors at any point. The only failure seen
before the adapter existed was the expected `Cannot find module
'../../src/memory/lancedb-store.ts'` — a plain "module not found," not a
native-load error — confirming the TDD red state was for the right reason.
After writing the adapter, the smoke test passed immediately with no native
warnings or quirks in stdout/stderr.

## FTS/hybrid search: DENSE-ONLY shipped

`hybridSearch()` currently performs **dense vector search only**, despite
the method name (kept per the stable interface contract from the brief).

Why: the installed 0.30.0 JS API does expose `Index.fts()` (confirmed in
`node_modules/@lancedb/lancedb/dist/indices.d.ts`) and `Table.search()`
accepts a `queryType` string (`"vector" | "fts" | "auto"`, per
`table.d.ts`), so hybrid is *plausibly* reachable. But wiring a real hybrid
query (fusing vector + FTS ranking, e.g. RRF) is not something the shipped
`.d.ts` documents cleanly — the type signatures for FTS query types
(`MatchQuery`, `PhraseQuery`, `BooleanQuery`, etc. in `query.d.ts`) exist
but there's no documented one-call "hybrid" convenience path exposed at the
level this adapter needs, and getting it wrong silently (e.g. wrong RRF
weights, wrong column) is worse than being honest about dense-only for now.

`openOrCreateTable` still opportunistically attempts
`table.createIndex('text', { config: lancedb.Index.fts() })` wrapped in a
try/catch, so:
- If it succeeds, the FTS index exists on disk for a future task to wire up
  hybrid search against without a schema migration.
- If it fails for any reason, dense search is completely unaffected (the
  try/catch swallows and moves on).

In this smoke test's run, FTS index creation did not throw, but I did not
verify the index is actually used for anything, since `hybridSearch` never
calls into an FTS query path. Treat "FTS index exists" as unconfirmed/best
effort, not a load-bearing fact for downstream code.

## Score direction

**Lower score = closer/better** (unchanged from LanceDB's native
`_distance` convention — mapped directly into `RetrievalResult.score`
without inversion). This is called out both in the class-level JSDoc on
`LanceStore` and here explicitly for the next task: **the retrieve pipeline
must sort/compare ascending by `score`**, not descending. Do NOT assume
higher-is-better cosine-similarity semantics.

## TDD evidence

**Before the adapter existed** (`bun test tests/memory/lancedb-smoke.test.ts`):

```
bun test v1.3.11 (af24e281)

tests/memory/lancedb-smoke.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../../src/memory/lancedb-store.ts' from '/Users/inderjotsingh/ai/tests/memory/lancedb-smoke.test.ts'
-------------------------------

 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [14.00ms]
```

This is a plain module-resolution failure, not a native-load error — correct
red state, no escalation triggered.

**After the adapter was implemented** (same command):

```
bun test v1.3.11 (af24e281)

 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file. [173.00ms]
```

## Verification commands run (all green except pre-existing unrelated item)

- `bun test tests/memory/lancedb-smoke.test.ts` → 1 pass, 0 fail.
- `bun run typecheck` → clean except one PRE-EXISTING, UNRELATED error:
  `tests/memory/sqlite-store.test.ts(1,51): error TS2307: Cannot find
  module 'vitest'`. Confirmed via `git log` that this file was introduced
  in the immediately-prior commit on this branch (`903b034 feat(memory):
  bun:sqlite space registry + doc manifest`) and already used `vitest`
  before this task touched anything. Not caused by, or fixed by, this task
  — flagging for slice-level cleanup (likely that file needs to move to
  `bun:test` like everything else, or add a `vitest` dev dependency —
  neither is in this task's scope).
- `bun run lint:file -- src/memory/lancedb-store.ts` → clean (after running
  `bunx biome check --write` once to apply pure formatting — no logic
  changes, just brace/line wrapping to match the 2-space/single-quote
  Biome config).
- `bun test` (full suite) → **235 pass, 16 skip, 0 fail** across 84 files.
  No regressions introduced.

## Self-review notes / edge cases considered

- **SQL injection in generated filter/delete predicates**: `id`,
  `namespace`, and `kind` values are interpolated into SQL-style predicate
  strings (`delete`, `.where()`). Added `escapeSqlLiteral()` (doubles single
  quotes) and apply it to every interpolated string value. `kind` is an
  enum (`MemoryKind`) so its string form is controlled, but I escaped it
  anyway for defense-in-depth since `String(q.kind)` is technically
  caller-controlled data at the type level.
- **Empty `records` array**: `upsert` early-returns on `records.length ===
  0` to avoid building a malformed empty `IN ()` predicate.
- **`namespace: ''` semantics**: per `types.ts`, `''` means space-wide (no
  namespace filter). `hybridSearch` treats `namespace == null || namespace
  === ''` as "no filter" — confirmed this matches the smoke test, which
  passes `namespace: ''` and expects to see both space-wide records.
- **Idempotent upsert**: `upsert` deletes any existing rows matching the
  incoming ids before `add`-ing, so calling it twice with the same records
  doesn't duplicate rows. Not explicitly tested here (out of scope for the
  smoke test) — worth a dedicated test in a later task.
- **Table existence caching**: `openOrCreateTable` checks `tableNames()`
  fresh on every call rather than caching a local "known tables" set. This
  is correct but does one extra round trip on repeated calls to the same
  space; not a concern at current scale, flagging in case it matters once
  there are many recall calls per run.
- **Connection reuse**: `db()` lazily connects once per `LanceStore`
  instance and reuses the connection — matches the sketch, no change
  needed there.
- Did NOT add a `.gitignore` entry for the smoke test's `/tmp/lance-smoke`
  dir since it's outside the repo and cleaned up via `afterEach`.

## Concerns for the next task (retrieve pipeline)

1. **Score direction is the single most important thing to carry
   forward.** `RetrievalResult.score` is a distance (lower = better). If
   the retrieve pipeline sorts, truncates to `topK`, or applies any
   score-threshold logic, it must do so ascending. This is the single most
   likely place for a silent, hard-to-notice bug.
2. **Dense-only for now.** If the slice plan assumes hybrid (dense + FTS)
   ranking is available from this layer, that assumption needs to be
   revisited or a follow-up task scheduled to wire real hybrid search. The
   FTS index is opportunistically created but never queried.
3. **No embedding-dimension validation.** `openOrCreateTable(space, dim)`
   trusts the caller's `dim` and never re-validates it against
   `SpaceMeta.embedDim` from `sqlite-store` — that authority check, per the
   `types.ts` comment ("SpaceMeta ... the authority for a space's embedder +
   dims"), needs to happen in the layer that calls both stores (likely the
   retrieve/write pipeline), not inside `LanceStore` itself.
4. **`sqlite-store.test.ts` vitest breakage** (pre-existing, not from this
   task) will keep failing `bun run typecheck` for anyone touching
   `docs:check`/`check` pipelines on this branch until it's fixed —
   flagging so the next task or a docs/cleanup pass doesn't get confused
   about which errors it introduced versus inherited.
5. **No retry/backoff or concurrent-writer story** — `LanceStore` assumes
   single-writer, single-process usage matching the smoke test. If the
   retrieve pipeline expects concurrent read/write safety guarantees beyond
   what LanceDB itself provides, that needs explicit design, not assumed
   from this adapter.
