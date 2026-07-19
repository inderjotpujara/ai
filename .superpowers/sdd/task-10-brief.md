## Task 10: `reconcileOrphans` — boot recovery in one transaction (§7.3) [OPUS/ultracode]

**Files:**
- Modify: `src/queue/store.ts` (add `reconcileOrphans`; remove the `_db`/`_encode`/`_decode` internal seams from the public return now all closures reference them via lexical scope)
- Create: `tests/queue/store-reconcile.test.ts`

**Interfaces:**
- Consumes: Task 6–9 store.
- Produces: `reconcileOrphans(): { interrupted: number; requeued: number }` — runs ONCE at boot inside a single `db.transaction()` BEFORE the pool accepts work (§7.3). Every row left `Running` from a crashed daemon is atomically transitioned: a **durable/checkpoint-resumable** job (crew/workflow — see Increment 6) → `Queued` (`requeued`), so the pool re-claims and resumes from its last checkpoint; every other `Running` job → `Interrupted` (`interrupted`), re-runnable only on explicit re-enqueue. Non-`Running` rows are untouched. **This slice (Increment 2) marks ALL orphans `Interrupted`** — the `requeued` branch is wired in Increment 6 once the checkpoint layer exists (a `durableKinds` predicate is threaded in then). Here it returns `requeued: 0` and the durable-requeue is a documented seam.

- [ ] **Step 1: Write the failing test**

`tests/queue/store-reconcile.test.ts`:
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

test('reconcileOrphans marks every stuck Running job Interrupted, leaves others', () => {
  const store = tempStore();
  const running = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const queued = store.enqueue({ kind: JobKind.Crew, payload: 2 });
  const done = store.enqueue({ kind: JobKind.Crew, payload: 3 });
  store.claimNext(); // running -> Running (the oldest queued)
  store.claimNext();
  store.markDone(done.id, null);
  const res = store.reconcileOrphans();
  expect(res.interrupted).toBeGreaterThanOrEqual(1);
  expect(res.requeued).toBe(0); // Increment 2: no durable-requeue yet
  expect(store.getJob(running.id)?.status).toBe(JobStatus.Interrupted);
  expect(store.getJob(queued.id)?.status).toBe(JobStatus.Interrupted); // was claimed 2nd
  expect(store.getJob(done.id)?.status).toBe(JobStatus.Done); // untouched
  store.close();
});

test('reconcileOrphans is a no-op when nothing is Running', () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Chat, payload: 1 });
  const res = store.reconcileOrphans();
  expect(res).toEqual({ interrupted: 0, requeued: 0 });
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-reconcile.test.ts` → FAIL.

- [ ] **Step 3: Implement `reconcileOrphans`**

```typescript
  function reconcileOrphans(): { interrupted: number; requeued: number } {
    // ONE transaction so no Running row is ever observed by a starting pool in
    // an ambiguous mid-flight state (§7.3). Increment 2 has no checkpoint layer
    // yet, so EVERY Running orphan -> Interrupted (re-runnable on explicit
    // re-enqueue only). Increment 6 threads a `durableKinds` predicate here to
    // send checkpoint-resumable rows -> Queued instead (counted as `requeued`).
    const tx = db.transaction((): { interrupted: number; requeued: number } => {
      const at = Date.now();
      const info = db.run(
        `UPDATE jobs SET status = 'interrupted', finished_at = ?, updated_at = ?
         WHERE status = 'running'`,
        [at, at],
      );
      return { interrupted: info.changes, requeued: 0 };
    });
    return tx();
  }
```
Add `reconcileOrphans,` to the returned object and DELETE the `_db`/`_decodeJobCursor`/`_encodeJobCursor` fields from the return (they were only a drafting seam).

- [ ] **Step 4: Run — verify it passes + full queue-store regression**

```bash
bun test tests/queue/store-reconcile.test.ts
bun test tests/queue/   # all store/type/migration tests green together
```

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-reconcile.test.ts
git add src/queue/store.ts tests/queue/store-reconcile.test.ts
git commit -m "feat(queue): reconcileOrphans boot recovery (Slice 24 Incr 2, §7.3)"
```

