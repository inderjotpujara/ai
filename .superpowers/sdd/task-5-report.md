# Task 5 Report — `src/session/store.ts` scaffold + upsertSession/getSession

## Implemented

- `src/session/store.ts`: `createSessionStore(config, deps)` factory opening
  `<config.path ?? 'sessions'>/sessions.db` with `mkdirSync` (parent dir),
  the WAL/busy_timeout(5000)/foreign_keys pragma trio (matches
  `src/memory/sqlite-store.ts:38-41` verbatim), then `migrate(db,
  SESSION_MIGRATIONS)`.
- Exports: `SessionRow` (camelCase DTO-shaped), `SessionRowRaw` (internal
  snake_case shape matching `sessions` table columns), `toSessionRow` mapper
  (`?? undefined` coercion for nullable `last_message_at`/`run_id`),
  `SessionStoreDeps = Record<string, never>` (empty, reserved for parity with
  `createMemoryStore(config, deps)`), `SessionStore = ReturnType<typeof
  createSessionStore>`.
- Returned closure: `upsertSession(id, { defaultTitle, at })` — `INSERT OR
  IGNORE` into `sessions` (id, title, owner='local', created_at, updated_at,
  last_message_at=NULL, run_id=NULL); `getSession(id)` — `SELECT * ... WHERE
  id = ?` mapped through `toSessionRow`, `undefined` if absent; `close()` —
  `db.close()`.
- Per brief: implemented ONLY these three methods this task. No
  rename/delete/appendMessage/listSessions (Tasks 6-8).

## RED

```
bun test tests/session/store.test.ts
error: Cannot find module '../../src/session/store.ts' from
'/Users/inderjotsingh/ai/tests/session/store.test.ts'
0 pass, 1 fail, 1 error
```

## GREEN

```
bun test tests/session/store.test.ts
5 pass
0 fail
15 expect() calls
Ran 5 tests across 1 file. [29.00ms]
```

Covers: create-on-first-call (all fields incl. `owner: 'local'`,
`lastMessageAt`/`runId` undefined), absent-id → undefined, idempotent
create-if-absent (title/createdAt/updatedAt untouched by a second upsert with
a different title/at), never-throws on repeat id, two distinct sessions
coexist independently.

## Gate

- `bun run typecheck` — clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/session/store.ts tests/session/store.test.ts` —
  clean after `bunx biome check --write` reformatted the test file's
  multi-line import (biome's own auto-fix, not a design change).
- Focused test — 5/5 pass (shown above, re-ran after the format fix too).

## Files changed

- `src/session/store.ts` (new)
- `tests/session/store.test.ts` (new)

## Commit

`59d323f` — `feat(session): add createSessionStore scaffold with
upsertSession/getSession (Phase 6 Incr 1)`

## Self-review

- Verified the pragma trio in `src/memory/sqlite-store.ts:38-41` matches the
  brief's prescribed trio exactly (WAL, busy_timeout=5000, foreign_keys=ON)
  before finalizing — no drift.
- Verified `src/session/migrations.ts` (Task 4) table/column names
  (`sessions`: id, title, owner, created_at, updated_at, last_message_at,
  run_id) line up 1:1 with `SessionRowRaw` and the `INSERT OR IGNORE` column
  list — no mismatch.
- `INSERT OR IGNORE` correctly relies on the `id TEXT PRIMARY KEY` constraint
  from Task 4's migration to make the second call a genuine no-op; confirmed
  via the idempotency test that `updated_at` is NOT touched (this is a true
  create-if-absent, not an upsert-with-touch — matches spec D2/D4 exactly:
  title is never overwritten, and neither is anything else on repeat).
- `noUncheckedIndexedAccess` strict mode: `toSessionRow`'s `?? undefined`
  coercion for `last_message_at`/`run_id` (nullable in SQL, `| null` in
  `SessionRowRaw`) satisfies the `number | undefined` / `string | undefined`
  target type in `SessionRow`.
- Kept `SessionStoreDeps` as `Record<string, never>` per brief (YAGNI: no
  clock override yet, reserved for a future test seam) rather than `{}` or
  `unknown`, consistent with strict-empty-object-type conventions.
- Did not add rename/delete/appendMessage/listSessions — confirmed scope stays
  to Task 5 only; return-object literal + `SessionStore` type alias are
  structured so Tasks 6-8 can add more closures to the same returned object
  without touching this task's code.

## Concerns

- None blocking. The only deviation from the brief's literal listing was
  biome auto-wrapping the test file's `import { createSessionStore, type
  SessionStore }` onto three lines — pure formatting, no semantic change, and
  required for `lint:file` to pass clean (biome's own repo-configured line
  width).
- `afterEach` calls `store.close()` then `rmSync` — order matters (DB must
  close before the WAL/SHM files can be removed cleanly); already correct in
  the test as prescribed by the brief.
