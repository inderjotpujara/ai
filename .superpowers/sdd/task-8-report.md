# Task 8 Report: Schema migrations + embedder-mismatch guard

## Implementation

1. **`src/db/migrate.ts`** (new) — `type Migration = { name: string; up: (db: Database) => void }` and `migrate(db: Database, migrations: Migration[]): number`. Reads `PRAGMA user_version`, applies each migration whose index is `>= version` inside its own `db.transaction(...)`, bumps `PRAGMA user_version` after each, returns the final version. One deviation from the brief's snippet: added `if (!m) continue;` after the array-index read, since the repo's `tsconfig.json` has `noUncheckedIndexedAccess` — `migrations[i]` types as `Migration | undefined` and the brief's version wouldn't typecheck as-is.

2. **`src/memory/sqlite-store.ts`** — added a module-level `MEMORY_MIGRATIONS: Migration[]` constant wrapping the two original `CREATE TABLE IF NOT EXISTS` statements (`spaces`, `documents`) byte-for-byte as a single v1 migration's `up`. The constructor now calls `migrate(this.db, MEMORY_MIGRATIONS)` in place of the two bare `db.run(...)` calls, after the existing WAL/busy_timeout/foreign_keys PRAGMAs (Task 6 ordering preserved).

3. **`src/memory/store.ts`** `ensureSpace` — when `sql.getSpace(space)` returns a row whose `embedModel` differs from `cfg.embedModel`, throws `MemoryError` with the brief's exact actionable message pointing at `memory reindex <space> <embedModel>` (the destructive escape hatch, which already existed in this file as `reindex()`). Same-embedder case is unaffected (still returns `existing`).

4. **Tests** — `tests/db/migrate.test.ts` and `tests/memory/ensure-space-guard.test.ts`, both derived from the brief with two required fixes (see below).

## Deviations from the brief's verbatim test code (both required for the suite to compile/pass; without them the tests either fail to typecheck or fail for the wrong reason)

- **`ensure-space-guard.test.ts`**: the brief's `remember(text, { space: 'default' })` calls omit `at`, but `remember`'s options type has `at: number` as required (not optional) — `tsc --noEmit` rejected this (`Property 'at' is missing`). Added `at: 1` / `at: 2` to the two calls.
- **`ensure-space-guard.test.ts`**: the brief's `deps(dim)` mock has `embedTexts: async () => []` — always returning an empty array regardless of input. `remember('hello', ...)` chunks the text into 1 chunk (single-sentence fast path in `chunk.ts`, which doesn't call `embed` at all) but then `writeChunks` calls `deps.embedTexts(['hello'])` directly and throws `MemoryError: embedTexts returned 0 vectors for 1 chunks` — before the code path under test (the second `createMemoryStore`'s `ensureSpace` guard) is ever reached. Fixed the mock to `texts.map(() => new Array(dim).fill(0))` (and `embedQuery` similarly) so `remember` succeeds normally and the *second* store's mismatched-embedder throw is what the test actually observes.
- `src/db/migrate.ts`'s `if (!m) continue` (noted above) — required for `bun run typecheck`, not a test-file change.

All three are minimal, mechanical fixes to make the brief's stated intent (RED then GREEN, final state passing `bun test` + `bun run typecheck`) actually hold; no behavior of `migrate`/`ensureSpace` was changed to accommodate them.

## TDD RED → GREEN

1. **RED**: wrote both test files verbatim from the brief (`at`/mock bugs not yet fixed). `bun test tests/db/migrate.test.ts tests/memory/ensure-space-guard.test.ts` failed: `migrate.test.ts` — `Cannot find module '../../src/db/migrate.ts'`; `ensure-space-guard.test.ts` — threw `MemoryError: embedTexts returned 0 vectors for 1 chunks` on the *first* `remember` call (wrong-reason failure, due to the mock bug above).
2. Fixed the mock + `at` fields in the guard test; re-ran — now failed with the *correct* symptom: `Expected promise that rejects. Received promise that resolved` (i.e. the pre-fix `ensureSpace` silently returns the stale space instead of throwing).
3. **GREEN**: implemented `src/db/migrate.ts`, wired it into `sqlite-store.ts`, added the guard in `store.ts`. `bun test tests/db/ tests/memory/` → 41 pass, 1 skip, 0 fail (81 expect() calls) — the pre-existing `sqlite-store.test.ts`/`store.test.ts`/etc. all still pass unchanged, confirming the v1 migration reproduces the schema exactly.
4. `bun run typecheck` — clean.
5. `bun run lint:file` on the 5 touched TS files — biome flagged pure formatting (line-wrapping) on both new test files and the migration constant in `sqlite-store.ts`; applied `bunx biome check --write`, re-ran lint (clean), re-ran tests (still 41 pass) and typecheck (still clean).

## Docs gate

`src/db/` is a new subsystem; `bun run docs:check` initially failed with `subsystem src/db/ is not documented in docs/architecture.md`. Added a **DB migrations** row to the architecture.md subsystem registry table (after **Core**, before **Reliability**) describing `migrate.ts`'s contract and its `memory/sqlite-store.ts` consumer. Also updated the existing **Memory / RAG** row to mention (a) the sqlite schema is now owned by `db/migrate.ts`'s `MEMORY_MIGRATIONS` and (b) `ensureSpace`'s new embedder-mismatch guard + the `reindex` escape hatch it points at, and added `db/migrate.ts` to that row's "Knows about" column. Re-ran `bun run docs:check` — passed (`✔ docs-check: living docs present + linked; every src subsystem documented.`).

## Files changed

- `src/db/migrate.ts` (new)
- `tests/db/migrate.test.ts` (new)
- `tests/memory/ensure-space-guard.test.ts` (new)
- `src/memory/sqlite-store.ts` (modified — `MEMORY_MIGRATIONS` + `migrate()` call)
- `src/memory/store.ts` (modified — `ensureSpace` guard)
- `docs/architecture.md` (modified — new DB migrations row + Memory/RAG row update)

## Self-review

- The v1 migration's SQL is character-identical to the two original `CREATE TABLE IF NOT EXISTS` statements — confirmed by the full `tests/memory/` suite (40 pass, 1 skip) passing unchanged, including `sqlite-store-wal.test.ts` and `sqlite-store.test.ts` which exercise the schema directly.
- `migrate` is idempotent: `tests/db/migrate.test.ts` asserts `migrate(db, ms)` returns `2` both times, and the version-gated `for` loop (`i = version; i < migrations.length`) is a no-op once `version === migrations.length`.
- The embedder guard throws only on a genuine mismatch: `ensure-space-guard.test.ts` covers the throwing path; the pre-existing `store.test.ts`/`wiring.test.ts` etc. (same embedder across calls, the common case) all still pass, confirming the same-embedder branch (`return existing`) is untouched.
- `docs:check` is green; no stray `console.log`; no lint/typecheck suppressions added.
- Left the unrelated pre-existing working-tree changes (`.remember/*`, other `.superpowers/sdd/task-*` briefs/reports) unstaged — only Task 8's own files were added to this commit.

## Commit

- `0cdb417` — `feat(db): user_version migration runner + memory embedder-mismatch guard` (on branch `slice-30a-production-foundation`, not pushed)

## Concerns / follow-ups (none blocking)

- `migrate()` has no rollback/down migrations — acceptable for this slice's scope (append-only forward migrations), but worth noting if a future migration needs to be reverted in production.
- The embedder-guard error message assumes the CLI's `memory reindex <space> <model>` argument order; if that CLI signature ever changes, the error string should be updated in lockstep (grep hit: `src/memory/store.ts`).
