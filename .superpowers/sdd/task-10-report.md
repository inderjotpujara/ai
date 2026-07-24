# Task 10 Report — `eval_history` append-only store (Slice 32, Increment 3)

## Summary

Added the append-only `eval_history` SQLite table + store, living in the SAME
`jobs.db` the queue and trigger stores already use, wired into the existing
`JOBS_DB_MIGRATIONS` migration superset per the R3 constraint.

## Files changed

- **Created** `src/self-improve/history-migrations.ts` — leaf module, exports
  `EVAL_HISTORY_MIGRATIONS: Migration[]` (one migration, `init-eval-history`:
  `CREATE TABLE eval_history` + `idx_eval_history_artifact_ts` index). Imports
  only `Migration` (type) from `../db/migrate.ts` — nothing from
  `../triggers/migrations.ts` or `./history.ts`.
- **Created** `src/self-improve/history.ts` — `EvalHistoryRow`,
  `EvalHistoryStore`, `createEvalHistoryStore`. Re-exports
  `EVAL_HISTORY_MIGRATIONS` from the leaf for a single import point. Imports
  `JOBS_DB_MIGRATIONS` from `../triggers/migrations.ts`.
- **Modified** `src/triggers/migrations.ts` — imports `EVAL_HISTORY_MIGRATIONS`
  from the leaf and appends it to `JOBS_DB_MIGRATIONS`:
  `[...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS, ...EVAL_HISTORY_MIGRATIONS]`.
  Extended the file-level doc comment on `JOBS_DB_MIGRATIONS` explaining the
  Slice 32 extension and why the append lands after `TRIGGER_MIGRATIONS`
  (never reordered — would corrupt existing DBs' `user_version`
  bookkeeping). `JOB_MIGRATIONS`/`TRIGGER_MIGRATIONS` themselves are
  untouched; `createJobStore` was NOT touched.
- **Created** `tests/self-improve/history.test.ts` — 9 tests (see below).
- **Modified** `tests/triggers/migrations.test.ts` — updated the
  "strict prefix" test to a 3-way split (`JOB_MIGRATIONS` +
  `TRIGGER_MIGRATIONS` + `EVAL_HISTORY_MIGRATIONS`) since it previously
  asserted a 2-way split that the new append would have broken; added the
  brief's `JOBS_DB_MIGRATIONS ends with the eval_history migration` test.

## R3 superset wiring — how the collision is avoided

`migrate(db, migrations)` (`src/db/migrate.ts`) tracks progress with a single
`PRAGMA user_version` per **database file**, not per migration list. `jobs.db`
is already opened independently by `createJobStore` (`JOB_MIGRATIONS`) and
`createTriggerStore` (the `JOBS_DB_MIGRATIONS` superset, itself
`JOB_MIGRATIONS` + `TRIGGER_MIGRATIONS`). Task 10 needed `eval_history` in the
same file without a third independent list colliding with whichever
`user_version` had already advanced.

Fix: extend the **existing authoritative superset** rather than defining a
new one. `JOBS_DB_MIGRATIONS` is now
`[...JOB_MIGRATIONS, ...TRIGGER_MIGRATIONS, ...EVAL_HISTORY_MIGRATIONS]`, and
`createEvalHistoryStore` calls `migrate(db, JOBS_DB_MIGRATIONS)` — the full
superset, never a `history`-only list. Because `migrate` only applies the
not-yet-applied tail of whatever list it's given, this holds regardless of
open order:

- job store opens first → `user_version` → `JOB_MIGRATIONS.length`; the eval
  store's later superset run applies the `TRIGGER_MIGRATIONS` +
  `EVAL_HISTORY_MIGRATIONS` tail.
- trigger store opens first → the superset run (now including eval_history)
  applies everything in one pass; the job store's later
  `migrate(db, JOB_MIGRATIONS)` call is then a no-op (`user_version` already
  past its own length).
- eval store opens first → same superset run applies everything; later job
  store / trigger store opens are no-ops for the same reason.

Verified directly in `tests/self-improve/history.test.ts` (`R3: a jobs.db
already advanced past JOB_MIGRATIONS by the job store still gets eval_history
when opened by the eval store`): pre-migrate a fresh `jobs.db` with
`migrate(db, JOB_MIGRATIONS)` only (simulating `createJobStore` having opened
it first), then open it through `createEvalHistoryStore` and confirm both
`jobs` and `eval_history` tables exist and an insert succeeds.

`JOB_MIGRATIONS` stays the authoritative jobs list and the required strict
prefix; `TRIGGER_MIGRATIONS` stays the required middle segment;
`EVAL_HISTORY_MIGRATIONS` is appended strictly after both, never reordered.

## Circular-import guard

The naive approach — define `EVAL_HISTORY_MIGRATIONS` inside `history.ts`
(which needs `JOBS_DB_MIGRATIONS` from `migrations.ts`) and have
`migrations.ts` import it back from `history.ts` — is a cycle:
`migrations.ts` → `history.ts` → `migrations.ts`.

Broken by putting `EVAL_HISTORY_MIGRATIONS` in a **leaf module**,
`src/self-improve/history-migrations.ts`, which imports only the `Migration`
type from `../db/migrate.ts` — nothing from `migrations.ts` or `history.ts`.
Resulting import graph:

- `history-migrations.ts` → `../db/migrate.ts` (leaf, no back-edges)
- `migrations.ts` → `history-migrations.ts` (+ existing `queue/migrations.ts`)
- `history.ts` → `migrations.ts` (for `JOBS_DB_MIGRATIONS`) and →
  `history-migrations.ts` (re-export only, for a single import point)

No cycle. Confirmed with `bun run typecheck` (clean — a real ESM cycle
between these two files would surface as a resolution/initialization-order
error) and empirically via `bun test`, which loaded and ran both modules
correctly (a genuine cycle would show up as `undefined`/`ReferenceError`
symptoms at import time).

## Store shape

Mirrors `createSessionStore` (`src/session/store.ts:111-121`): same
`join(config.path ?? 'jobs', 'jobs.db')` path convention (matching
`createJobStore`'s `'jobs'` default, since it's the same file), same
`mkdirSync(dirname(dbPath), { recursive: true })`, same WAL /
`busy_timeout=5000` / `foreign_keys=ON` pragma trio, then
`migrate(db, JOBS_DB_MIGRATIONS)`.

Row mapping (snake_case columns ↔ camelCase `EvalHistoryRow`): `passed`,
`regressed`, `below_bar` are `INTEGER` 0/1 ↔ `boolean`; `per_case` is a TEXT
JSON column round-tripping `EvalCaseResult[]` via `JSON.stringify`/`JSON.parse`;
`baseline_model`/`reason` are nullable TEXT columns mapped to `undefined`
(never `null`) on read, matching the `EvalHistoryRow` type's optional fields.

`EvalHistoryStore` surface: `insert`, `listByArtifact` (`ORDER BY ts DESC`),
`latestPassing` (`WHERE passed = 1 AND regressed = 0 ORDER BY ts DESC LIMIT
1`), `close`. **No `update`/`delete` method is defined anywhere** — asserted
directly by a test.

## TDD — RED then GREEN

**Step 1 — wrote the tests first** (all 4 from the brief, plus 5 extra: a
baseline/reason round-trip, absent-artifact tolerance on both readers, the R3
superset-order proof, and an absent-directory-creates-fine check), plus the
2 additions to `tests/triggers/migrations.test.ts`.

**Step 2 — RED, verified for real** (not just reasoned about): temporarily
moved both new `src/self-improve/history.ts` and
`src/self-improve/history-migrations.ts` out of the tree and ran:

```
$ bun run test:file -- "tests/self-improve/history.test.ts" "tests/triggers/migrations.test.ts"
error: Cannot find module '../../src/self-improve/history-migrations.ts' from '/Users/inderjotsingh/ai/tests/triggers/migrations.test.ts'
error: Cannot find module '../../src/self-improve/history.ts' from '/Users/inderjotsingh/ai/tests/self-improve/history.test.ts'
 0 pass
 2 fail
```

Confirmed genuinely RED (both test files fail to even load), then restored
the two implementation files.

**Step 3 — implementation** as described above.

**Step 4 — GREEN:**

```
$ bun run test:file -- "tests/self-improve/history.test.ts" "tests/triggers/migrations.test.ts"
 17 pass
 0 fail
 38 expect() calls
Ran 17 tests across 2 files. [112.00ms]
```

(9 in `history.test.ts` + 8 in the extended `migrations.test.ts`.)

**Step 5 — gate:**

```
$ bun run typecheck
$ tsc --noEmit
(clean — no import-cycle error)

$ bun run lint:file -- src/self-improve/history.ts src/self-improve/history-migrations.ts \
    src/triggers/migrations.ts tests/self-improve/history.test.ts tests/triggers/migrations.test.ts
$ biome check ...
(one formatting nit in the test file, fixed by hand, then clean)
```

**Broader regression check** — re-ran everything touching `jobs.db` openers
plus adjacent stores, to make sure the superset extension didn't disturb
existing behavior:

```
$ bun test --path-ignore-patterns 'web/**' --path-ignore-patterns 'spikes/**' \
    tests/queue tests/triggers tests/self-improve tests/session tests/db
 233 pass
 0 fail
 2038 expect() calls
Ran 233 tests across 36 files. [3.91s]
```

## Self-review

- **R3 correctness**: confirmed both by the code (single superset import,
  no independent migration list anywhere) and by a test that pre-advances
  `user_version` via `JOB_MIGRATIONS` alone before opening through the eval
  store — the exact silent-collision scenario the brief calls out.
- **Append-only invariant**: no `update`/`delete` function exists in
  `history.ts` at all (not merely unexported) — there is nothing to
  accidentally wire up later; a test also pins this at the store-object
  level.
- **Ordering**: `EVAL_HISTORY_MIGRATIONS` is appended strictly after
  `TRIGGER_MIGRATIONS`; the existing prefix (`JOB_MIGRATIONS` then
  `TRIGGER_MIGRATIONS`) is untouched and re-asserted by the updated
  "strict prefix" test (now a 3-way split).
  `TRIGGER_MIGRATIONS`/`JOB_MIGRATIONS` arrays themselves were not edited.
- **Circular import**: verified structurally (leaf module has zero imports
  from either `migrations.ts` or `history.ts`) and behaviorally (typecheck +
  test run both clean; a real cycle here would surface as a resolution
  failure at import time, not a subtle logic bug, so a clean run is
  reasonably strong evidence).
- **`createJobStore` untouched**: confirmed via `git diff` scope — only
  `src/triggers/migrations.ts` was modified among the existing stores;
  `src/queue/store.ts` / `src/queue/migrations.ts` are unchanged.
- One judgment call beyond the brief's literal test list: the outer task
  instructions asked for "malformed/absent DB tolerated" as a scenario. The
  brief's own 4 sample tests don't cover this explicitly, so I interpreted
  it as absent-*data* tolerance (an unknown `artifactId` on `listByArtifact`/
  `latestPassing` must return `[]`/`undefined`, never throw) plus
  absent-*directory* tolerance (a nested non-existent path is created on
  open, matching `createSessionStore`/`createJobStore`'s existing
  `mkdirSync` behavior) — both are now covered by dedicated tests. I did
  not add a "corrupt SQLite file bytes" test since neither `createSessionStore`
  nor `createJobStore` guard against that today (a truly malformed file
  throws from `bun:sqlite` itself, consistent with sibling stores), so adding
  divergent behavior here would be scope creep beyond mirroring their shape.

## Concerns

- None blocking. One minor forward-looking note for whichever later task
  wires up `reevalArtifact`'s (`src/self-improve/reeval.ts`) output into this
  store: `EvalHistoryRow.model` is required (no default), so the caller must
  supply the freshly-resolved model identity (`ReevalOutcome`'s
  `resolved.decl.model`) explicitly when building the row to insert —
  `createEvalHistoryStore` does no inference from `EvalResult` alone.
- Note for reviewers: this file previously held a Slice 31 (A2A) Task 10
  report under the same path; that content has been fully replaced above
  with this slice's Task 10 (self-improvement `eval_history` store). The
  old A2A content is preserved in git history if needed.

## Commit

`4bf676f` — `feat(self-improve): append-only eval_history store in jobs.db
(JOBS_DB_MIGRATIONS superset extension)`
