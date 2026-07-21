# Task 7 Report — `JobStore.stats()` single-query per-status counts (§7.2 race-free)

**Status:** COMPLETE. Committed `b3d70bd` — `feat(queue): race-free single-query JobStore.stats() (Slice 25b Incr 2, §7.2)`.

## Implementation
- `src/queue/store.ts`:
  - Changed `JobStatus` from a `type`-only import to a **value** import (`import { ..., JobStatus, ... } from './types.ts'`) so `Object.values(JobStatus)` works at runtime for zero-filling.
  - Added `stats(): { counts: Record<JobStatus, number>; total: number }` inside `createJobStore` and exposed it on the returned closure (`stats,` in the object literal, alongside `listJobs`/`reconcileOrphans`).
- `tests/queue/store-stats.test.ts` (new): the two mandated tests verbatim from the brief (biome only re-wrapped long lines + sorted the `bun:test` import — no semantic change).

## §7.2 mechanism used + WHY it is race-safe
A **single** `SELECT status, COUNT(*) AS n FROM jobs GROUP BY status` — one read, one row-set, one snapshot. All per-status counts are computed at the SAME instant by SQLite over one table scan, so `sum(counts) === total` by construction (`total` is accumulated from the very same rows the counts come from).

`bun:sqlite` executes **synchronously**: the `.all()` call runs to completion with no `await` inside it, so no interleaved `claimNext`/`markDone`/`markFailed` write from the worker-pool loops can land partway through the aggregation. The naive failure mode — six separate `COUNT(*) WHERE status=?` reads — takes six DIFFERENT mid-transition snapshots as the pool moves rows `Queued→Running→Done`, so a job in flight is double-counted or missed and `sum(counts) ≠ total`. The single GROUP BY eliminates that window entirely.

Zero-fill: `counts` is pre-seeded with every `JobStatus` value = 0, then rows overwrite present statuses. This satisfies the Task-3 `QueueStatsDtoSchema.counts = z.partialRecord(...)` as a superset (full Record ⊇ partial), and the panel always gets all keys (a missing key would render blank, not 0). An unknown status value is guarded (`if (r.status in counts)`) so it never NaNs the sum, while still contributing to `total`.

Per the brief, `activeCount` is **NOT** added here — it is the route's job (Task 8), sourced from `pool.activeCount()` and reported as a distinct field, never reconciled by arithmetic with the DB `running` count.

## TDD RED/GREEN evidence
- **RED** (before impl): `bun test tests/queue/store-stats.test.ts` → `TypeError: store.stats is not a function` on both tests. `0 pass / 2 fail`.
- **GREEN** (after impl): `2 pass / 0 fail`, **1408 expect() calls** — the race test ran 200 `stats()` reads against a live 4-worker pool churning 40 jobs, asserting `sum(counts) === total` AND every count `>= 0` on every read; all held.

## Gate
- `bun run typecheck` → clean (`tsc --noEmit`, no errors).
- `bun run lint:file -- src/queue/store.ts tests/queue/store-stats.test.ts` → clean (after `biome check --write` auto-fixed import-sort + line-wrap in the test only).
- Regression: ran new test + `store-claim/enqueue/lineage/list/reconcile/transitions` + `pool` + `concurrency` → **42 pass / 0 fail** (1503 expect calls). No store/pool regression.

## Files changed
- `src/queue/store.ts` (value import of `JobStatus`; `stats()` added + exported)
- `tests/queue/store-stats.test.ts` (new)

## Concerns
- None functional. The brief's test code triggered biome format/import-sort auto-fixes (cosmetic line-wrapping only, semantics identical). Full suite is the controller's job.

---

## Follow-up fix — adversarial review (2026-07-20)

**Status:** COMPLETE. Committed `1124181` — `fix(queue): stats() total=sum(counts) invariant + accurate race-safety rationale (Slice 25b T7 review)`.

An adversarial review approved `stats()` as race-safe but flagged two accuracy points, both fixed surgically:

1. **Invariant robustness (Minor).** Previously `total += r.n` ran for every grouped row unconditionally, while a count only landed in a bucket when `r.status in counts`. A stray/unknown status row would have inflated `total` past `sum(counts)`, breaking the DTO's documented invariant. Fix: moved `total += r.n` inside the `if (r.status in counts)` branch, so `total` is now accumulated exactly as the sum of the assigned bucket values — `total === sum(counts)` holds by construction, not by coincidence.
2. **Accurate rationale comment.** The old comment attributed race-safety to "GROUP BY vs six separate COUNTs racing." The real safety property is that `stats()` is a single synchronous, yield-free `bun:sqlite` read (no `await` in its body), so no pool write can interleave mid-read regardless of query shape. Rewrote the comment to state this, and noted the single GROUP BY is chosen for single-statement clarity and to future-proof against a later move to async reads (where a multi-statement version genuinely could race).
3. **Test wording.** Renamed/reworded the concurrency test in `tests/queue/store-stats.test.ts` from claiming to guard against a "six-COUNT regression" (a scenario that can't occur under the synchronous runtime) to accurately describing it as a **self-consistency invariant under live concurrency**: `sum(counts) === total` holds on every read while a real 4-worker pool churns rows, plus zero-fill correctness. No assertions were weakened — the 200-iteration live-pool-churn loop and the repeated `sum === total` check are unchanged.

### Gate
- `bun run typecheck` → clean.
- `bun run lint:file -- src/queue/store.ts tests/queue/store-stats.test.ts` → clean (`Checked 2 files. No fixes applied.`).
- `bun test tests/queue/store-stats.test.ts` → **2 pass / 0 fail**, 1408 expect() calls.
- Regression: `bun test tests/queue/` (full dir, since a bare `store.test.ts`/`pool.test.ts` split doesn't exist as named — confirmed via `ls`) → **50 pass / 0 fail** across 12 files, 1516 expect() calls. No regressions.

### Files changed
- `src/queue/store.ts` (`stats()` closure only)
- `tests/queue/store-stats.test.ts` (comment/test-name only, assertions unchanged)

---
---

# Task 7 Report — Slice 25 (Triggers): Trigger store — CRUD + atomic claimDueCron + firings

> NOTE — filename collision: this `task-7-report.md` already held **Slice 25b**'s
> Task 7 (`JobStore.stats()`, above). Appended below (not overwritten) to preserve
> that continuity record. The section below is the **Slice 25 (slice-25-triggers)**
> Task 7 deliverable.

**Status:** COMPLETE — all gates green.
**Branch:** slice-25-triggers
**Commit:** `96c3043` — feat(triggers): trigger store with atomic claimDueCron + enabled overlay

## Files
- Created `src/triggers/store.ts` — `createTriggerStore(config, deps)` factory + `export type TriggerStore = ReturnType<...>`.
- Created `tests/triggers/store.test.ts` — the three brief tests verbatim (biome-reformatted, no semantic change).
- Edited `src/triggers/types.ts` — added `export type TriggerStoreDeps = Record<string, never>` to mirror the `JobStoreDeps` register (the brief's test calls the factory with one arg, so deps is optional with a `{}` default).

## What was built
- DB opened EXACTLY as `createJobStore`: `join(path ?? 'jobs', 'jobs.db')`, WAL + busy_timeout=5000 + foreign_keys=ON, then `migrate(db, JOBS_DB_MIGRATIONS)` (the superset — never `TRIGGER_MIGRATIONS` alone).
- Full surface per the produced interface: `create` (with `extra.tokenHash`), `get`, `getByName`, `getByTokenHash`, `list`, `listByOrigin`, `update`, `remove`, `claimDueCron`, `recordFiring`, `listFirings`, `latestFiring`, `upsertRepo`, `pruneRepo`, `close`.
- `claimDueCron` copied VERBATIM from the brief — one `db.transaction(...).immediate()` (BEGIN IMMEDIATE); select-due + advance-next_run_at in one critical section; `computeNext` invoked inside the transaction; a `null` from `computeNext` parks the row (nulls `next_run_at`); advances `next_run_at`/`updated_at` ONLY — never `last_fired_at` (M5 contract).
- `create` mints `trig-<base36 ms>-<base36 rand>` (mirrors `newJobId` via a shared `newId(prefix)`); `recordFiring` mints `f-<...>`. `enabled` stored as `input.enabled === false ? 0 : 1`; target payload + config serialized to JSON TEXT; `tokenHash` → `token_hash`.
- `upsertRepo` = `getByName(name, Repo)` → if found, UPDATE type/target/config/secret_ref/updated_at but NOT enabled/id/next_run_at (overlay survives); else `create({...input, origin: Repo})`.
- `pruneRepo` deletes repo rows whose name ∉ keepNames; empty keep-set special-cased to delete ALL repo rows (empty `NOT IN` would match nothing).
- `listFirings`/`latestFiring` use the `(fired_at DESC, id ASC)` keyset — mirrors `encodeJobCursor`/`decodeJobCursor` on `fired_at`; stable under equal `fired_at` (id ASC tiebreak).

## Reviewer probe answers
- (a) select+advance is genuinely ONE `.immediate()` transaction — no read-then-write gap (verbatim from brief; test proves a second same-`now` claim returns `[]`).
- (b) `upsertRepo` never clobbers `enabled` — its UPDATE column list excludes enabled/id/next_run_at; test asserts `enabled === false` survives re-sync while config updates.
- (c) keyset cursor stable under equal `fired_at` via `(fired_at < ? OR (fired_at = ? AND id > ?))` + `ORDER BY fired_at DESC, id ASC`.

## Verification
- `bun run typecheck` — clean.
- `bun run lint:file -- src/triggers/store.ts tests/triggers/store.test.ts src/triggers/types.ts` — clean (removed an unused `TriggerTarget` import; `biome --write` applied formatting).
- `bun run test:file -- tests/triggers/` — 12 pass / 0 fail (3 new + 9 Increment-1), 33 expect() calls.
- pre-commit `docs:check` passed on commit.

## Concerns
- None blocking. `list`/`listByOrigin` ordering (`created_at DESC, id ASC`) was unspecified by the brief; chose newest-first to match the `listJobs` convention.

## Fix pass

Two Minor findings from this Task's reviews, both applied on branch `slice-25-triggers`:

1. **Coverage gap — `listFirings` page-2/cursor-decode untested.** Added
   `tests/triggers/store.test.ts` test `'firings keyset list page 2 continues from
   the cursor with no overlap/gap'`: records 3 firings (`firedAt` 1/2/3) for a
   trigger, fetches page 1 with `limit:2` (asserts `[3,2]` + `nextCursor`
   defined + `total:3`), then fetches page 2 with that cursor (asserts `[1]` +
   `nextCursor` undefined + `total:3`), and checks the concatenation of both
   pages is exactly `[3,2,1]` with no duplicate `firedAt` — proving no
   overlap/no gap across the keyset boundary and exercising `decodeFiringCursor`
   for the first time.
2. **Hardening — `claimDueCron` due-scan predicate.** `src/triggers/store.ts`
   (due-scan `WHERE` clause): changed `enabled = 1` to `enabled != 0`, with a
   comment noting this matches `toTrigger`'s read mapping (`enabled !== 0`),
   removing a theoretical divergence if an external writer ever stored a
   truthy non-1 value for `enabled`.

**Verification:**
- `bun run typecheck` — clean.
- `bun run lint:file -- src/triggers/store.ts tests/triggers/store.test.ts` — clean, no fixes needed.
- `bun run test:file -- tests/triggers/` — 13 pass / 0 fail (up from 12; the 1 new test), 41 expect() calls.

Commit: `fix(triggers): align claim scan enabled predicate + cover firings keyset page-2`.
- Filename-collision note above (report appended, not overwritten).
