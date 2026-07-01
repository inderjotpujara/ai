# Task 3 report: `MemoryStore.getByIds`

## Implemented

- `LanceStore.getByIds(space, ids: string[]): Promise<RetrievalResult[]>` in
  `src/memory/lancedb-store.ts` — a non-vector filter query distinct from
  `hybridSearch`. Empty `ids` short-circuits to `[]` (no query issued).
  Reuses the file's existing `escapeSqlLiteral` helper for id literals and
  mirrors `hybridSearch`'s row-mapping pattern (`Array<Record<string, unknown>>`
  cast, then field-by-field typed extraction — no `any`).
- `MemoryStore.getByIds(space, ids)` in `src/memory/store.ts` — thin delegate
  to `lance.getByIds(space, ids)`, added next to `stats()` in the returned
  facade object.

## LanceDB query API confirmed

Checked `node_modules/@lancedb/lancedb/dist/table.d.ts` and `query.d.ts`
directly (installed version 0.30.0):
- `Table.query(): Query` (both the abstract declaration and the concrete
  `Table` class expose it).
- `Query extends StandardQueryBase<NativeQuery>`, which provides
  `.where(predicate: string): this` and (via the base `QueryBase`)
  `.toArray(options?): Promise<any[]>`.

So the brief's proposed `tbl.query().where(\`id IN (...)\`).toArray()` is the
real, current API — no deviation needed. Row shape from `.toArray()` is
`any[]`, so I cast to `Array<Record<string, unknown>>` and typed each field
on extraction (matching `hybridSearch`'s existing pattern) to satisfy biome's
`noExplicitAny`.

## TDD

- **RED**: wrote `tests/memory/getbyids.test.ts` (mirrors
  `tests/memory/lancedb-smoke.test.ts` — real LanceDB, tiny 2-row table, 60s
  timeout) per the brief's exact test. Ran `bun test tests/memory/getbyids.test.ts`
  → failed with `TypeError: s.getByIds is not a function`, confirming the
  test exercises real (not-yet-existing) behavior.
- **GREEN**: implemented `getByIds` in `lancedb-store.ts` and `store.ts`.
  Re-ran the same test → `1 pass / 0 fail / 3 expect() calls`.

## Files changed

- `src/memory/lancedb-store.ts` — added `getByIds` method (+18 lines).
- `src/memory/store.ts` — added `getByIds` facade delegate (+4 lines).
- `tests/memory/getbyids.test.ts` — new test file (44 lines), per brief.
- `tests/cli/memory.test.ts` — **not in the brief's file list**, but required:
  its `fakeStore()` builds a structurally-typed `MemoryStore` object literal
  for CLI tests, and TypeScript's structural typing means adding `getByIds`
  to the `MemoryStore` return type broke this mock (`tsc` reported "Property
  'getByIds' is missing"). Added a matching `getByIds` stub (pushes
  `'getByIds'` to the `calls` log, returns one fixture row) to keep the mock
  in sync with the real facade shape.

## Verification run

- `bun test tests/memory/getbyids.test.ts` → 1 pass, 0 fail, 3 expect() calls.
- `bun run typecheck` → clean (`tsc --noEmit`, no errors).
- `bun run lint:file -- src/memory/lancedb-store.ts src/memory/store.ts`
  (+ the two new/modified test files individually via `bunx biome check`) →
  clean. Note: `bun run lint:file` with multiple paths only reported
  "Checked 1 file" due to biome's git-VCS-aware mode (`useIgnoreFile: true`)
  interacting with `tests/memory/getbyids.test.ts` being untracked at lint
  time; verified each file individually and via the full `bun run lint` pass
  below to be sure.
- `bun run lint` (full repo) → 5 pre-existing formatting errors, all in
  `src/verification/config.ts`, `src/verification/types.ts`,
  `tests/verification/config.test.ts`, `tests/verification/spans.test.ts` —
  these are Task 1/2 files, untouched by this task. No errors in any file
  this task touched.
- `bun run test` (full suite) → **263 pass, 18 skip, 0 fail, 530 expect()
  calls, 281 tests across 94 files** (52.93s).

## Self-review

- Signature matches the brief exactly: `getByIds(space: string, ids: string[]): Promise<RetrievalResult[]>` on both `LanceStore` and the `MemoryStore` facade.
- Empty-ids fast path avoids issuing a query (as specified) and avoids
  constructing an invalid `id IN ()` SQL predicate.
- `score: 0` for all rows is intentional and matches the brief — these are
  citation lookups, not ranked search results, so distance/score is
  meaningless here.
- Reused `escapeSqlLiteral` rather than re-implementing escaping, keeping a
  single source of truth for SQL-literal safety in this file.
- No `any` in new code; row extraction pattern is consistent with the
  existing `hybridSearch` method for maintainability.

## Concerns

- **Unplanned edit to `tests/cli/memory.test.ts`**: the brief scoped only
  `lancedb-store.ts` + `store.ts` (+ the new test), but adding `getByIds` to
  the `MemoryStore` return type is a breaking structural change for any
  hand-written mock of that type. This CLI test mock was the only such
  consumer found; fixing it was necessary for `bun run typecheck` and the
  full suite to pass. Future tasks that extend `MemoryStore`'s shape should
  expect the same ripple.
- No caller wires up `getByIds` yet (that's presumably a later task in the
  Slice 13 sequence — the verifier consuming `[mem:<id>]` citations). This
  task only adds the primitive.
- `git add` on `src/memory/*` files prints a `.gitignore` warning (the repo's
  `memory/` ignore pattern also covers `src/memory/` and `tests/memory/`
  paths lexically) even though these are already-tracked files; harmless,
  but the new `tests/memory/getbyids.test.ts` required `git add -f` to be
  tracked, matching how `tests/memory/lancedb-smoke.test.ts` must have been
  added originally.

---
**Commit:** `d7fead1` — feat(memory): getByIds(space, ids) for citation-evidence lookup
