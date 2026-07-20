# Task 5 Report: Trigger tables migration

## Status
Done.

## Files
- Created `src/triggers/migrations.ts`
- Created `tests/triggers/migrations.test.ts`

## What was implemented
- `TRIGGER_MIGRATIONS: Migration[]` — two entries, `init-triggers` (creates
  `triggers` table + `idx_triggers_due` + `idx_triggers_token` indexes) and
  `init-trigger-firings` (creates `trigger_firings` table +
  `idx_firings_list` index), matching the brief's exact column set/SQL
  verbatim.
- `JOBS_DB_MIGRATIONS: Migration[] = [...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS]`
  — `JOB_MIGRATIONS` is imported live from `src/queue/migrations.ts` (not
  copied), so it is guaranteed to stay a strict, up-to-date prefix. Extensive
  header comment on `JOBS_DB_MIGRATIONS` documents the single-`PRAGMA
  user_version`-per-database mechanism and why the trigger store must run
  this superset rather than a bare `migrate(db, TRIGGER_MIGRATIONS)`.
- `createJobStore` was NOT touched — it continues to call
  `migrate(db, JOB_MIGRATIONS)` unchanged, per the brief.

## Tests (7 tests, 20 expect() calls, all passing)
1. `JOBS_DB_MIGRATIONS is JOB_MIGRATIONS followed by TRIGGER_MIGRATIONS (strict prefix)` — structural check on the array composition itself.
2. `open order 1: job store opens first (JOB_MIGRATIONS), then the trigger store runs the superset` — proves `migrate(db, JOB_MIGRATIONS)` then `migrate(db, JOBS_DB_MIGRATIONS)` yields both `jobs` and the two trigger tables, and `user_version` lands at `JOBS_DB_MIGRATIONS.length`.
3. `open order 2: trigger store opens first (superset), then the job store opens (prefix) with no error` — proves the reverse open order is also safe: the superset creates everything, and the job store's later (unmodified) `migrate(db, JOB_MIGRATIONS)` call is a pure no-op (no error, no version regression, no re-run).
4. `trigger tables land even after JOB_MIGRATIONS already advanced user_version` — the brief's literal Step-1 test, kept verbatim.
5. `init-triggers creates the triggers table with the Trigger record columns` — full column-list assertion via `PRAGMA table_info`.
6. `init-trigger-firings creates the trigger_firings table with the TriggerFiring record columns` — same, for the firings table.
7. `JOBS_DB_MIGRATIONS is idempotent (re-migrate is a no-op)` — re-running the superset twice is a no-op and returns the same final version.

## TDD sequence
1. Wrote the test file first (including the brief's literal snippet) → confirmed FAIL (`Cannot find module '../../src/triggers/migrations.ts'`).
2. Implemented `src/triggers/migrations.ts` per the brief.
3. Re-ran → 7 pass, 0 fail.

## Gate results
- `bun run typecheck` — clean.
- `bun run lint:file -- src/triggers/migrations.ts tests/triggers/migrations.test.ts` — one formatting fix applied (wrapped the test's multi-symbol import onto multiple lines to satisfy biome's line-width rule), then clean.
- `bun test tests/triggers/migrations.test.ts` — 7 pass, 0 fail, 20 expect() calls.

## Commit
`fe79b63` — "feat(triggers): trigger + trigger_firings tables (combined jobs.db migration list)"
Files staged explicitly (`git add src/triggers/migrations.ts tests/triggers/migrations.test.ts`), not `git add -A` — the unrelated modified ledger/scratch files already present in the working tree (`.remember/`, `.superpowers/sdd/progress.md`, other task briefs/reports) were left untouched by this commit.

## Concerns / notes for the reviewer
- None outstanding. The two open-order tests (#2 and #3 above) are the concrete proof the audit asked for: both directions end with all tables present and `user_version` at the correct final value (`JOBS_DB_MIGRATIONS.length`), and neither direction throws.
- `createJobStore` and `JOB_MIGRATIONS` itself were left completely untouched — confirmed by reading `src/queue/migrations.ts` before writing any code; no edits were made there. `JOB_MIGRATIONS` currently has 3 entries (post Task 4's origin/chain_depth migration), so `JOBS_DB_MIGRATIONS.length` is 5.
- No `createTriggerStore` yet — that's a later task in this slice. This task's only contract surface is the exported `TRIGGER_MIGRATIONS` / `JOBS_DB_MIGRATIONS` arrays for that later task to consume.
- This report file previously held stale content from an unrelated earlier "Task 5" (a Slice 25b DaemonLogs query/response contract task) — it has been overwritten with this task's actual report.
