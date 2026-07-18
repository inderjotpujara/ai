# Task 4 Report: `src/session/migrations.ts` — `SESSION_MIGRATIONS`

## Summary

Implemented per the brief, verbatim, via TDD. `src/session/` and `tests/session/`
are new directories (first files in a new module, mirroring `src/memory/`'s
shape). One migration (`'init-sessions-and-messages'`) creates `sessions` and
`messages` plus the `idx_messages_session(session_id, created_at)` index
needed by Task 7's `getMessages` ORDER BY.

## Confirmed contracts before writing

Read `src/db/migrate.ts` first, per the task instructions:
- `Migration = { name: string; up: (db: Database) => void }`.
- `migrate(db, migrations)` reads `PRAGMA user_version`, applies each pending
  `Migration.up` inside its own transaction, bumps `user_version` after each,
  and **returns the resulting version number**. A second call against an
  already-migrated db runs zero loop iterations and returns the same version
  — this is the idempotency the tests assert.

## TDD evidence

**RED** (before `src/session/migrations.ts` existed):
```
error: Cannot find module '../../src/session/migrations.ts' from '/Users/inderjotsingh/ai/tests/session/migrations.test.ts'
0 pass / 1 fail / 1 error
```

**GREEN** (after creating `src/session/migrations.ts`, brief's Step 3 code
verbatim):
```
5 pass
0 fail
10 expect() calls
Ran 5 tests across 1 file. [32.00ms]
```

## Files changed

- `src/session/migrations.ts` (new) — `SESSION_MIGRATIONS: Migration[]`.
- `tests/session/migrations.test.ts` (new) — 5 tests, brief's Step 1 code
  verbatim except one biome auto-reflow (see Gate below).
- `docs/architecture.md` (new module-map row, see Docs below).

## Gate (all three, run before commit)

- `bun run typecheck` → clean, no output.
- `bun run lint:file -- src/session/migrations.ts tests/session/migrations.test.ts`
  → 1 formatting error on the first run: biome wanted the
  `'sessions row defaults owner to \'local\'...'` test name re-quoted to
  double-quotes (to avoid the escaped single-quote) and the inline object-type
  cast on `SELECT * FROM sessions` reflowed to multi-line. Both are
  semantically identical to the brief's snippet (same string, same type). Ran
  `bunx biome check --write tests/session/migrations.test.ts` to apply the
  fix, then re-ran both `lint:file` (0 errors) and the focused test (still
  5/5 pass) to confirm nothing broke.
- `bun test tests/session/migrations.test.ts` → 5/5 pass (see GREEN above).

## Docs (the hard line)

`src/session/` is a **brand-new subsystem** — this is its first file — so
`bun run docs:check` (the pre-commit hook) correctly failed on the first
commit attempt: `subsystem src/session/ is not documented in docs/architecture.md`.

I checked the SDD ledger (`.superpowers/sdd/progress.md`) for precedent before
deciding how to handle this, since the task brief itself doesn't mention an
architecture.md edit. Found the exact prior lesson from the Slice-27 media
subsystem's first task (Task A2): *"new src/<subsystem> first task MUST commit
the architecture.md row atomically (docs:check passes on working-tree so an
uncommitted edit masks it)."* I also confirmed (via `grep` across
`task-*-brief.md`) that the only briefs mentioning `architecture.md` are
`task-30`/`task-31`, which on inspection are **stale Phase-5 leftovers**
(landing the already-merged Builders+Library phase), not part of this Phase-6
plan — so there is no dedicated later "docs" task in this phase's 39-task
plan that would pick this up instead.

Given that precedent, I added one new module-map table row for
**Session / Chat history** (`docs/architecture.md`, next to the "DB
migrations" row) describing exactly what exists today — schema only
(`SESSION_MIGRATIONS`, the two tables, the index, the two reserved-but-unused
columns) — and noting the store/API land in later Phase 6 tasks, so the claim
stays accurate as the module grows. Re-ran `bun run docs:check` → green, then
committed all three files (`src/session/migrations.ts`,
`tests/session/migrations.test.ts`, `docs/architecture.md`) atomically in one
commit, per the lesson above (an uncommitted docs edit would mask the gate on
a second commit attempt).

I did **not** touch README.md/ROADMAP.md — those are the pre-**push**
slice-landing gate's concern (a `docs/architecture.md` change on a push to
`main`), not the pre-**commit** hook, and this branch isn't landing yet
(Phase 6 has many more increments to go).

## Commit

`ca5a491` — `feat(session): add SESSION_MIGRATIONS (sessions + messages tables) (Phase 6 Incr 1)`
3 files changed, 138 insertions(+): `src/session/migrations.ts`,
`tests/session/migrations.test.ts`, `docs/architecture.md`.

## Self-review

- Schema matches the brief's verbatim SQL exactly: `sessions(id PK, title
  NOT NULL, owner NOT NULL DEFAULT 'local', created_at, updated_at,
  last_message_at NULL, run_id NULL)`, `messages(id PK, session_id NOT NULL
  REFERENCES sessions(id), parent_message_id NULL, role, parts TEXT NOT NULL,
  created_at, degraded NULL)`, `idx_messages_session(session_id,
  created_at)`.
- One migration only (YAGNI, per the task's explicit instruction) — did not
  add speculative future migrations or columns.
- `type`-only imports used for both `Database` and `Migration`, per the
  global constraints.
- No `console.log`, no deviation from the brief's code.
- FK enforcement test explicitly turns `PRAGMA foreign_keys = ON` first,
  since SQLite doesn't enforce FKs by default — this matches `bun:sqlite`'s
  real default-off behavior, so the test is asserting real DB behavior, not
  a false positive.

## Concerns

- None outstanding. The one open question (does a new-subsystem task need to
  touch `docs/architecture.md` itself) is resolved above using the exact
  documented ledger precedent, not a guess.

## Note on this report file

This file previously held a stale report from an earlier phase's differently-
numbered Task 4 (Library enum mirrors, Phase 5). That content has been
replaced with this Phase 6 Task 4 report; the earlier work it described was
already committed under its own SHA in an earlier phase and is unaffected.
