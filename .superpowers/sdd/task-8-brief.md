## Task 8: Terminal transitions — `markDone` / `markFailed` / `markInterrupted` / `markCanceled`

**Files:**
- Modify: `src/queue/store.ts`
- Create: `tests/queue/store-transitions.test.ts`

**Interfaces:**
- Consumes: Task 6/7 store.
- Produces: `markDone(id, result)` (→ Done, sets `result` JSON + `finished_at`), `markFailed(id, error, retryable)` (retryable AND `attempts < maxAttempts` → back to `Queued` for another claim **with `available_at = now + backoffDelay(attempts)`** so the re-claim is spaced by a persisted, full-jitter exponential backoff — NOT immediately re-claimable; else → `Failed` with `error` + `finished_at`), `markInterrupted(id)` (→ Interrupted + `finished_at`), `markCanceled(id)` (→ Canceled + `finished_at`). All bump `updated_at`. `backoffDelay` reuses `retryBaseMs`/`retryCapMs` (`src/reliability/config.ts:32,36`) — the SAME knobs as `src/reliability/retry.ts`'s `withRetry`, so queue retries and in-run retries share one backoff policy. This moves the delay COMPUTATION into the store (persisted in `available_at`) so the worker pool never sleeps holding a slot (Task 13).

- [ ] **Step 1: Write the failing test**

`tests/queue/store-transitions.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('markDone stores the result and terminal status', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: 'x' });
  store.claimNext();
  store.markDone(job.id, { ok: true, count: 3 });
  const done = store.getJob(job.id);
  expect(done?.status).toBe(JobStatus.Done);
  expect(done?.result).toEqual({ ok: true, count: 3 });
  expect(done?.finishedAt).toBeGreaterThan(0);
  store.close();
});

test('markFailed with retryable + attempts<max re-queues with a backoff floor', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: 'x', maxAttempts: 2 });
  store.claimNext(); // attempts -> 1
  const before = Date.now();
  store.markFailed(job.id, 'boom', true);
  const requeued = store.getJob(job.id);
  expect(requeued?.status).toBe(JobStatus.Queued); // 1 < 2, retry
  // The backoff is persisted as a future available_at, so claimNext will NOT
  // immediately re-claim it — this is what actually spaces re-claims.
  expect(requeued?.availableAt).toBeGreaterThan(before);
  expect(store.claimNext()).toBeNull(); // gated by the backoff floor
  store.close();
});

test('markFailed fails terminally once attempts reach maxAttempts', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: 'x', maxAttempts: 1 });
  store.claimNext(); // attempts -> 1 == max
  store.markFailed(job.id, 'boom again', true); // retryable but no attempts left
  const failed = store.getJob(job.id);
  expect(failed?.status).toBe(JobStatus.Failed); // 1 == max, terminal
  expect(failed?.error).toBe('boom again');
  store.close();
});

test('markFailed with retryable=false fails terminally on the first attempt', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: 'x', maxAttempts: 5 });
  store.claimNext();
  store.markFailed(job.id, 'fatal', false);
  expect(store.getJob(job.id)?.status).toBe(JobStatus.Failed);
  store.close();
});

test('markInterrupted and markCanceled set their terminal statuses', () => {
  const store = tempStore();
  const a = store.enqueue({ kind: JobKind.Chat, payload: 1 });
  const b = store.enqueue({ kind: JobKind.Chat, payload: 2 });
  store.claimNext();
  store.markInterrupted(a.id);
  store.markCanceled(b.id);
  expect(store.getJob(a.id)?.status).toBe(JobStatus.Interrupted);
  expect(store.getJob(b.id)?.status).toBe(JobStatus.Canceled);
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-transitions.test.ts` → FAIL.

- [ ] **Step 3: Implement the four transitions**

First widen the top-of-file reliability import (added in Task 6) so `markFailed` can compute a persisted backoff:
```typescript
import {
  maxAttempts as defaultMaxAttempts,
  retryBaseMs,
  retryCapMs,
} from '../reliability/config.ts';
```
Add this module-scope helper next to `newJobId` (it mirrors `withRetry`'s full-jitter exponential backoff, `src/reliability/retry.ts:74-76`, using the SAME `retryBaseMs`/`retryCapMs` knobs so queue + in-run retries share one policy):
```typescript
/** Full-jitter exponential backoff (ms) for a re-queued job's `available_at`.
 *  `attempt` is tries USED (claimNext already bumped it). Reuses the reliability
 *  backoff knobs — never a hardcoded delay. */
function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const exp = Math.min(retryCapMs(), retryBaseMs() * 2 ** Math.max(0, attempt - 1));
  const jitter = 0.5 + rand() / 2;
  return Math.floor(jitter * exp);
}
```
Then add inside `createJobStore` and to the returned object:
```typescript
  function markDone(id: string, result: unknown): void {
    const at = Date.now();
    db.run(
      `UPDATE jobs SET status = 'done', result = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(result ?? null), at, at, id],
    );
  }

  function markFailed(id: string, error: string, retryable: boolean): void {
    const at = Date.now();
    const row = getJob(id);
    // Retry if the caller says the error is retryable AND we have attempts left.
    // `attempts` was already bumped by claimNext, so it reflects tries USED.
    const canRetry = retryable && row !== undefined && row.attempts < row.maxAttempts;
    if (canRetry) {
      // Persist the backoff as an `available_at` floor so claimNext won't
      // re-claim this row until it matures — the delay is enforced durably in
      // the DB, not by a worker sleeping on a held slot (Task 13).
      const availableAt = at + backoffDelay(row.attempts);
      db.run(
        `UPDATE jobs SET status = 'queued', error = ?, updated_at = ?,
         started_at = NULL, available_at = ? WHERE id = ?`,
        [error, at, availableAt, id],
      );
      return;
    }
    db.run(
      `UPDATE jobs SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [error, at, at, id],
    );
  }

  function markInterrupted(id: string): void {
    const at = Date.now();
    db.run(
      `UPDATE jobs SET status = 'interrupted', finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [at, at, id],
    );
  }

  function markCanceled(id: string): void {
    const at = Date.now();
    db.run(
      `UPDATE jobs SET status = 'canceled', finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [at, at, id],
    );
  }
```
Add `markDone, markFailed, markInterrupted, markCanceled,` to the returned object.

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/store-transitions.test.ts` → PASS (5 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-transitions.test.ts
git add src/queue/store.ts tests/queue/store-transitions.test.ts
git commit -m "feat(queue): markDone/Failed/Interrupted/Canceled transitions (Slice 24 Incr 2)"
```

