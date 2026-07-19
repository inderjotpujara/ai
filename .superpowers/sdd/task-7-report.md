# Task 7 report — `claimNext` atomic priority-then-FIFO Queued→Running

**Status:** Complete. Commit `0ded43f` — `feat(queue): atomic claimNext priority-then-FIFO (Slice 24 Incr 2)`.
Focused queue tests: **16/16 passing** (7 in store-claim.test.ts + the extended enqueue suite).

## claimNext SQL + transaction approach
Added `claimNext(now = Date.now()): JobRecord | null` to `createJobStore` (`src/queue/store.ts`).
The whole select-then-update is one `db.transaction()`:

- SELECT the winner:
  `SELECT * FROM jobs WHERE status = 'queued' AND available_at <= ?
   ORDER BY priority ASC, created_at ASC, id ASC LIMIT 1` (bound to `now`).
  Served by `idx_jobs_claim(status, priority, created_at)`. `priority ASC` uses the
  JobPriority enum TEXT ordering (High < Normal lexically), `created_at ASC` = FIFO,
  `id ASC` = stable tiebreak.
- If no row → return `null`.
- UPDATE with the guard:
  `UPDATE jobs SET status='running', started_at=?, updated_at=?, attempts=attempts+1
   WHERE id=? AND status='queued'`.
- Re-SELECT the row and map via `toJobRecord`, returning the updated `JobRecord`.

**Why it's single-claim:** bun:sqlite is synchronous, so the transaction body is a
critical section; `busy_timeout=5000` serialises concurrent writers and the
`WHERE status='queued'` clause is the atomic guard — two workers can never both flip
the same row. I used the contract's `now = Date.now()` signature (superset of the
brief's no-arg form) so the eligibility gate is deterministically testable; all tests
call it with no args.

## TDD RED/GREEN evidence
- RED: `bun test tests/queue/store-claim.test.ts` → `1 pass, 6 fail` — every claim test
  failed with `TypeError: store.claimNext is not a function`; only the enum-intent
  assertion passed.
- GREEN: after implementing, `bun test tests/queue/` → `16 pass, 0 fail`.
- Gate: `bun run typecheck` clean (`tsc --noEmit`), `bun run lint:file` clean (biome, no fixes).

## Correctness-contract bullets → the test that proves each
- **Eligibility gate (status='queued')** — "a claimed row is never re-claimed" + "two
  sequential claims return two DIFFERENT job ids" (a Running row is never re-selected).
- **Eligibility gate (available_at <= now)** — "a job with a future available_at is not
  claimed until it matures" (older future job skipped, matured younger job claimed).
- **Priority ordering (High before Normal)** — "claimNext returns High-priority before
  Normal…" (High enqueued LAST, claimed FIRST) + intent test "JobPriority enum orders
  High before Normal".
- **FIFO within priority** — same test: the two Normal jobs come back oldest-first (n1 then n2).
- **Atomic transition + fields** — "claimNext flips the row to Running, sets started_at,
  bumps attempts" (status=Running, attempts=1, startedAt>0, and persisted via getJob).
- **No double-claim across two calls** — "a claimed row is never re-claimed" (second call
  → null) + "two sequential claims return two DIFFERENT job ids".
- **Empty / no eligible rows → null** — "claimNext on an empty store returns null" and the
  trailing `expect(store.claimNext()).toBeNull()` in the priority + future-gate tests.

## Folded-in review findings
1. **JobStoreDeps duplication collapsed** — deleted the local
   `export type JobStoreDeps = Record<string, never>;` from `store.ts` and now import the
   type from `./types.ts`. No caller imports it via the store path (grep confirmed only
   the two declarations existed), so no re-export needed. Typecheck stays clean.
2. **availableAt assertion added** — new test in `tests/queue/store-enqueue.test.ts`
   proves `enqueue` defaults `availableAt` to `0` (returned + persisted) and that an
   explicit `availableAt` survives `enqueue`→`getJob`. Protects the field Task 8's retry
   backoff depends on.

**Bonus hardening:** a module-load guard `if (!(JobPriority.High < JobPriority.Normal)) throw`
makes the enum lexical-ordering dependency explicit and self-checking (per the "don't
silently rely on alphabetical — assert the intent" directive), with a matching intent test.

## Files changed
- `src/queue/store.ts` — added `claimNext`, collapsed JobStoreDeps import, priority-order guard.
- `tests/queue/store-claim.test.ts` — new (7 tests).
- `tests/queue/store-enqueue.test.ts` — added availableAt default/preservation test.

## Concerns
- None blocking. The `now` param is a small, backward-compatible deviation from the
  brief's no-arg signature (matches the task-context contract `claimNext(now = Date.now())`
  and keeps the available_at gate deterministically testable). Concurrency is guaranteed by
  the synchronous single-transaction model, not a multi-process stress test — appropriate
  for bun:sqlite; real multi-worker behaviour is exercised by Task 14's integration suite.
