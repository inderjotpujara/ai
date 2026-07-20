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
