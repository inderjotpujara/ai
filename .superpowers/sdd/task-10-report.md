# Task 10 report — `reconcileOrphans` boot recovery (§7.3, Slice 24 Incr 2)

**Status:** DONE. Commit `774095e` — `feat(queue): reconcileOrphans boot recovery (Slice 24 Incr 2, §7.3)`.

## What shipped
- `src/queue/store.ts`: added `reconcileOrphans(): { interrupted: number; requeued: number }`; deleted the `_db` / `_decodeJobCursor` / `_encodeJobCursor` drafting seams from the returned object (confirmed no external references via grep before removal — `encode/decodeJobCursor` remain used internally by `listJobs`).
- `tests/queue/store-reconcile.test.ts`: new (4 tests).

## The implementation (SQL + transaction)
One atomic unit via `db.transaction(fn).immediate()` — BEGIN IMMEDIATE takes the write lock at BEGIN (same hardening as `claimNext`), so a starting worker pool can never observe a `running` row mid-reconcile:

```sql
UPDATE jobs SET status = 'interrupted', finished_at = ?, updated_at = ?
WHERE status = 'running'
```
Returns `{ interrupted: info.changes, requeued: 0 }`. `WHERE status='running'` means ONLY running rows are touched; every other state is inherently excluded. Count comes straight from the UPDATE's `.changes`.

## Count semantics
`interrupted` = number of rows the single UPDATE actually changed (running orphans flipped). `requeued` = always `0` this increment.

## Signature-evolution note (Increment 6 / Task 41)
The return shape `{ interrupted, requeued }` is forward-declared for the durable-resume variant. In Increment 6, once the checkpoint layer exists, a `durableKinds` predicate is threaded in so checkpoint-resumable orphans (crew/workflow) go `running -> queued` (counted as `requeued`, re-claimed and resumed from last checkpoint) instead of `interrupted`. Until then ALL orphans -> `interrupted` and `requeued` stays 0. This is documented inline in the function body as a seam. (The brief framed the future capability as a threaded predicate rather than an optional arg on this signature, so the zero-arg form ships as-is; no optional param was added.)

## TDD RED -> GREEN
- RED: `store.reconcileOrphans is not a function` (all tests errored before implementation).
- GREEN: 29/29 `tests/queue/` pass, stable across 5 consecutive runs.

## §7.3 contract — each bullet has a test
1. **Running orphan -> Interrupted w/ finished_at set** — test "reconciled orphan carries finished_at and is not re-claimable" (asserts status Interrupted + `finishedAt > 0`); also the multi-job test.
2. **Non-running rows untouched (queued/done/failed/interrupted/canceled)** — test "leaves failed and canceled rows untouched" drives one row into each of Failed / Canceled / pre-existing Interrupted + one live Running, asserts only the Running flips; the main test also asserts a Done row is untouched.
3. **Returns correct COUNT** — main test asserts `interrupted === 2` (two claimed orphans); finished_at test asserts `=== 1`; the untouched-states test asserts `=== 1` (only the single live Running).
4. **No double-exec: interrupted job not re-claimed** — finished_at test asserts `store.claimNext()` returns `null` after reconcile (interrupted is neither queued nor running).
5. **Empty / no-running -> returns 0, no error** — verbatim brief test "reconcileOrphans is a no-op when nothing is Running" asserts `{ interrupted: 0, requeued: 0 }`.

## Concern — the brief's verbatim first test was FLAKY (fixed)
The brief's exact sample test assumed `claimNext` claims jobs in insertion order (`running` then `queued`). It does NOT: three enqueues land in the same millisecond so they tie on `created_at`, and `claimNext`'s `ORDER BY created_at ASC, id ASC` tiebreak then falls to the id's **random** suffix (`job-<ms>-<rand>`). Verified empirically — claim order varied run-to-run (`1 3`, `3 2`, `2 3`, `1 2`). The verbatim test passed only ~1/3 of the time (when `done` happened to hold the largest id). This is a sample-code defect (cf. the "plan-sample-code ships defects" lesson), not an implementation bug — my UPDATE is correct.

**Fix:** rewrote that test to be deterministic — it CAPTURES the two jobs `claimNext` actually returns, marks the remaining unclaimed one Done, then asserts both captured orphans -> Interrupted, the unclaimed -> Done, and `interrupted === 2`. Same contract, no order assumption. (Import order alphabetized and non-null assertions replaced with narrowing guards to satisfy biome.) The no-op test was kept verbatim.

## Gate
`bun test tests/queue/` 29 pass / 0 fail (x5 stable) · `bun run typecheck` OK · `bun run lint:file` OK (0 errors/warnings on both files) · pre-commit docs-check passed.

## Files changed
- `src/queue/store.ts`
- `tests/queue/store-reconcile.test.ts` (new)
