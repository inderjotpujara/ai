## Task 7: `JobStore.stats()` — single-query per-status counts (§7.2 race-free) [OPUS / ultracode ADVERSARIAL-VERIFY]

> **⚠ ADVERSARIAL-VERIFY (§7.2 — queue-stats accuracy under live concurrency).** **Naive failure mode:** computing per-status counts as six separate `COUNT(*) WHERE status=?` reads while the worker pool concurrently transitions rows (`Queued→Running→Done`) — the six snapshots are taken at different instants, so `sum(counts) ≠ total` and a job is double-counted or missed. **Mechanism:** ONE `SELECT status, COUNT(*) … GROUP BY status` inside the store's normal synchronous read (one consistent `bun:sqlite` snapshot). `activeCount` is reported SEPARATELY by the route (from `pool.activeCount()`), NEVER reconciled with the DB `running` count by arithmetic. **Acceptance test (Step 1 below) is mandatory and must not be softened:** enqueue + drive N jobs through a live pool and assert, on repeated `stats()` calls, `sum(counts.values) === total` EVERY time and no count is negative.

**Files:**
- Modify: `src/queue/store.ts` (add `stats()` to the returned closure)
- Test: `tests/queue/store-stats.test.ts` (new)

**Interfaces:**
- Consumes: the Task-6 `db` + `JobStatus` (`src/queue/types.ts`).
- Produces: `stats(): { counts: Record<JobStatus, number>; total: number }` on `JobStore` — one `GROUP BY status` read; `counts` has an entry for EVERY `JobStatus` value (missing statuses default to `0`); `total = sum(counts)`.

- [ ] **Step 1: Write the failing race-consistency test** — `tests/queue/store-stats.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerPool } from '../../src/queue/pool.ts';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

function tempStore() {
  return createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
}

test('stats() reports every JobStatus with zero-defaults and total=sum', () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Crew, payload: 1 });
  store.enqueue({ kind: JobKind.Crew, payload: 2 });
  const s = store.stats();
  // Every status key present (zero-defaulted), even the ones with no rows.
  for (const status of Object.values(JobStatus)) {
    expect(typeof s.counts[status]).toBe('number');
  }
  expect(s.counts[JobStatus.Queued]).toBe(2);
  expect(s.total).toBe(2);
  store.close();
});

test('sum(counts) === total on EVERY read while a pool churns rows (§7.2)', async () => {
  const store = tempStore();
  for (let i = 0; i < 40; i++) store.enqueue({ kind: JobKind.Chat, payload: i });
  const pool = createWorkerPool({
    store, concurrency: 4, pollMs: 1,
    dispatch: () => async () => ({ ok: true }),
  });
  pool.start();
  // Hammer stats() while the pool transitions rows underneath it.
  for (let i = 0; i < 200; i++) {
    const s = store.stats();
    const sum = Object.values(s.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.total);            // never off-by-one across a transition
    for (const v of Object.values(s.counts)) expect(v).toBeGreaterThanOrEqual(0);
    await Bun.sleep(0);
  }
  await pool.stop();
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails** — `bun test tests/queue/store-stats.test.ts` → FAIL (`stats` is not a function).

- [ ] **Step 3: Implement `stats()`** — add inside `createJobStore` and to the returned object:
```typescript
  function stats(): { counts: Record<JobStatus, number>; total: number } {
    // ONE read, ONE consistent snapshot: a single GROUP BY over the whole
    // table, so the six per-status counts are all taken at the SAME instant.
    // Six separate COUNT(*) reads would each see a different mid-transition
    // moment (§7.2), breaking sum(counts) === total. bun:sqlite is synchronous,
    // so this query is atomic w.r.t. any interleaved claimNext/markDone write.
    const rows = db
      .query(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`)
      .all() as { status: string; n: number }[];
    // Zero-default EVERY status so the wire DTO always has all keys (the panel
    // renders a fixed row set; a missing key would render as blank, not 0).
    const counts = Object.fromEntries(
      Object.values(JobStatus).map((s) => [s, 0]),
    ) as Record<JobStatus, number>;
    let total = 0;
    for (const r of rows) {
      // Guard an unknown status value defensively (never NaN the sum).
      if (r.status in counts) counts[r.status as JobStatus] = r.n;
      total += r.n;
    }
    return { counts, total };
  }
```
Add `stats,` to the returned object literal. Import `JobStatus` as a VALUE (not just a type) in `src/queue/store.ts` — it is currently imported `type JobStatus`; change to `import { ..., JobStatus, ... }` so `Object.values(JobStatus)` works at runtime.

- [ ] **Step 4: Run — verify green** — `bun test tests/queue/store-stats.test.ts` → PASS (2 tests).

- [ ] **Step 5: Gate + commit**
```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-stats.test.ts
git add src/queue/store.ts tests/queue/store-stats.test.ts
git commit -m "feat(queue): race-free single-query JobStore.stats() (Slice 25b Incr 2, §7.2)"
```

