# Task 13 report — `createWorkerPool` (bounded, cancellable worker pool)

**Commit:** `b98cc9d` — feat(queue): bounded worker pool with cancel + retry (Slice 24 Incr 2)
**Files added:** `src/queue/pool.ts`, `tests/queue/pool.test.ts`
**Branch:** `slice-24-daemon-queue-remote`

> Note: this path previously held a stale report titled "downsampler.ts" from an
> earlier slice reusing the `task-13` filename; overwritten with this slice's
> Task 13 (worker pool). Prior content remains in git history.

## Async structure

- **Claim loops:** `start()` spins `max(1, concurrency)` concurrent `loop()` promises. Each
  loop: `store.claimNext()` → if `null`, `await abortableSleep(pollMs)` and continue (idle
  backoff, no hot-spin); if a job, `runOne(job)`, tracked in an `inFlight` Set, awaited, then
  removed. Loop exits when `running` flips false.
- **Per-job `runOne`:** builds a fresh `AbortController`, registers it in
  `controllers: Map<jobId, AbortController>`, calls `dispatch(job.kind)(job, signal)`. On
  success (and only if not aborted) `store.markDone`; on throw (and only if not aborted)
  `store.markFailed(id, explain(err).title, jobRetryDecision(err).retryable)`. `finally`
  always deletes the controller from the map — a throwing executor can never wedge a loop.
- **No worker-side backoff sleep:** on a retryable failure the worker does NOT sleep. Per the
  Increment-2 design, `markFailed` persists the backoff as the row's `available_at` and
  `claimNext`'s `available_at <= now` gate enforces spacing — so a failing job never holds a
  concurrency slot while it waits.
- **`stop()` (drain):** sets `running=false`, aborts every live controller, `await
  Promise.allSettled(inFlight)` then `await Promise.allSettled(loops)`, then sweeps any row
  still `Running` → `markInterrupted` (the same state `reconcileOrphans` assigns). Terminates
  cleanly — a loop mid-`abortableSleep` finishes its (small) poll wait then sees `running=false`
  and exits; no hung loop.
- **`cancel(jobId)`:** looks up the controller; if absent returns `false`; else `abort()` +
  `store.markCanceled(jobId)` and returns `true`. The aborted-signal guard in `runOne` makes
  the executor's subsequent throw/resolve a no-op so the cancel transition is never overwritten.
- **`activeCount()`:** `controllers.size`.

## TDD

- **RED:** wrote `tests/queue/pool.test.ts` first → `bun test` failed with
  `Cannot find module '../../src/queue/pool.ts'`.
- **GREEN:** implemented `pool.ts` (verbatim to the brief) → 8/8 pass. Full `tests/queue/`
  suite 42/42. Ran the pool test 3× — stable, no flakiness (this is the concurrent piece).

## Contract bullet → test

| Contract | Test |
|---|---|
| claim → dispatch → markDone with result | "the pool claims, dispatches, and marks a job Done with its result" |
| **bounded concurrency (peak ≤ N)** | "concurrency bounds the number of jobs in flight at once" — dispatch records peak concurrent invocations; concurrency=2, 4 slow jobs, `expect(peak).toBeLessThanOrEqual(2)` |
| throwing job → markFailed, correct retryability | "a throwing (terminal) job is marked Failed…" (plain Error → Terminal → not retryable → Failed) + "a transient (retryable) failure re-queues…" (ECONNRESET → Transient → retryable → back to Queued, proving the flag threads through) |
| **cancel → abort + markCanceled** | "cancel aborts an in-flight job and marks it Canceled" — signal fires (executor rejects on `abort`), job ends Canceled, `cancel()` returns true |
| **drain (stop awaits in-flight then resolves)** | "stop() drains: awaits an in-flight non-abortable job then marks the straggler Interrupted" — a signal-ignoring 50ms executor; stop() awaits it then reconciles the still-Running row → Interrupted; proves stop resolves (no hang) |
| activeCount accuracy | "activeCount reflects the number of executing jobs" — 0 before start, 2 while both gated executors run, 0 after drain |
| empty-queue no-busy-spin | "an empty queue does not busy-spin claimNext" — wraps `store.claimNext` with a counter; over 260ms at pollMs=50, `expect(claims).toBeLessThan(20)` (a busy loop = thousands) |

## Proofs of the two hard properties

- **Bounded concurrency:** the dispatch increments a shared `inFlight` counter, records
  `peak = max(peak, inFlight)`, sleeps, decrements. Peak can only reach the number of loops
  executing simultaneously; asserting `peak ≤ concurrency` with more jobs than slots proves the
  loops never exceed the bound.
- **No busy-spin:** replacing `store.claimNext` with a counting wrapper and bounding the call
  count over a fixed wall-clock window directly measures the idle-poll rate — the
  `abortableSleep(pollMs)` on the empty-queue path keeps it to ~5-6 calls, not thousands.

## Gate

- `bun test tests/queue/` → 42 pass / 0 fail.
- `bun run typecheck` → clean.
- `bun run lint:file -- src/queue/pool.ts tests/queue/pool.test.ts` → clean (Biome
  organize-imports/format + an unused-param rename `_j` in the brief's cancel test were applied;
  cosmetic only, behavior unchanged).

## Concerns

- `abortableSleep(pollMs)` in the idle path is called without a signal, so `stop()` does not
  wake a mid-sleep loop early — it waits out the remaining poll interval (≤ pollMs, small).
  Acceptable: termination guaranteed, just not instantaneous. A future task wanting instant
  drain on an idle pool could thread a pool-level AbortSignal into that sleep.
- No HTTP / real executors here by design — `dispatch` is injected; real executors wire in
  Increment 3.
- The retryable-re-queue test relies on the ~500–1000ms `available_at` backoff window
  (retryBaseMs default 1000) to observe the Queued state; robust given current config but
  coupled to that default.
