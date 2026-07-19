## Task 7: `claimNext` — atomic priority-then-FIFO `Queued→Running` in a transaction (§7.3 no-double-claim) [OPUS/ultracode]

**Files:**
- Modify: `src/queue/store.ts` (add `claimNext` to the returned closure object)
- Create: `tests/queue/store-claim.test.ts`

**Interfaces:**
- Consumes: the Task 6 `db`/mappers.
- Produces: `claimNext(): JobRecord | null` on the `JobStore` — picks the highest-priority, oldest Queued row and flips it to Running **atomically** in a single `db.transaction()` so two concurrent pool workers can never claim the same row (the core §7.3 correctness property). Sets `status='running'`, `started_at`, `updated_at`, `attempts = attempts + 1`.

- [ ] **Step 1: Write the failing test**

`tests/queue/store-claim.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobPriority, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('claimNext returns High-priority before Normal, then FIFO by createdAt', async () => {
  const store = tempStore();
  const n1 = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  await Bun.sleep(2);
  const n2 = store.enqueue({ kind: JobKind.Crew, payload: 2 });
  await Bun.sleep(2);
  const h1 = store.enqueue({ kind: JobKind.Crew, payload: 3, priority: JobPriority.High });
  // High first, then Normals oldest-first.
  expect(store.claimNext()?.id).toBe(h1.id);
  expect(store.claimNext()?.id).toBe(n1.id);
  expect(store.claimNext()?.id).toBe(n2.id);
  expect(store.claimNext()).toBeNull();
  store.close();
});

test('claimNext flips the row to Running, sets started_at, bumps attempts', () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const claimed = store.claimNext();
  expect(claimed?.status).toBe(JobStatus.Running);
  expect(claimed?.attempts).toBe(1);
  expect(claimed?.startedAt).toBeGreaterThan(0);
  // Persisted, not just returned:
  expect(store.getJob(job.id)?.status).toBe(JobStatus.Running);
  store.close();
});

test('a claimed row is never re-claimed (no double-claim)', () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const first = store.claimNext();
  const second = store.claimNext();
  expect(first).not.toBeNull();
  expect(second).toBeNull(); // the only Queued row is gone
  store.close();
});

test('a job with a future available_at is not claimed until it matures', () => {
  const store = tempStore();
  // Enqueued FIRST (older created_at) but scheduled into the future.
  store.enqueue({ kind: JobKind.Chat, payload: 'later', availableAt: Date.now() + 60_000 });
  // Enqueued SECOND but already claimable.
  const ready = store.enqueue({ kind: JobKind.Chat, payload: 'now', availableAt: Date.now() - 1_000 });
  // Despite being older, the future job is skipped; the matured one is claimed.
  expect(store.claimNext()?.id).toBe(ready.id);
  // The future job is still gated — nothing else claimable yet.
  expect(store.claimNext()).toBeNull();
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-claim.test.ts` → FAIL (`claimNext` is not a function).

- [ ] **Step 3: Implement `claimNext`**

Add inside `createJobStore`, and add `claimNext` to the returned object:
```typescript
  function claimNext(): JobRecord | null {
    // Single transaction: SELECT the winning Queued row then UPDATE it to
    // Running, so two workers calling claimNext concurrently cannot both read
    // the same row as Queued and both claim it (busy_timeout=5000 serialises
    // the writers; the UPDATE's WHERE status='queued' is the guard). bun:sqlite
    // runs synchronously, so the transaction body is a critical section.
    const tx = db.transaction((): JobRecord | null => {
      const now = Date.now();
      // `available_at <= now` gates retry-backoff'd rows: a job re-queued by
      // markFailed with a future available_at is NOT re-claimed until it
      // matures, so backoff actually spaces re-claims under concurrency
      // (the delay is enforced here, durably, not by a worker sleeping).
      const r = db
        .query(
          `SELECT * FROM jobs WHERE status = 'queued' AND available_at <= ?
           ORDER BY priority ASC, created_at ASC, id ASC LIMIT 1`,
        )
        .get(now) as JobRowRaw | undefined;
      if (!r) return null;
      const at = now;
      db.run(
        `UPDATE jobs SET status = 'running', started_at = ?, updated_at = ?,
         attempts = attempts + 1 WHERE id = ? AND status = 'queued'`,
        [at, at, r.id],
      );
      const claimed = db.query('SELECT * FROM jobs WHERE id = ?').get(r.id) as
        | JobRowRaw
        | undefined;
      return claimed ? toJobRecord(claimed) : null;
    });
    return tx();
  }
```
Add `claimNext,` to the returned object literal.

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/store-claim.test.ts` → PASS (3 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-claim.test.ts
git add src/queue/store.ts tests/queue/store-claim.test.ts
git commit -m "feat(queue): atomic claimNext priority-then-FIFO (Slice 24 Incr 2)"
```

