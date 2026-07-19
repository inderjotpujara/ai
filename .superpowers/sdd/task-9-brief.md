## Task 9: `listJobs` — keyset page + status filter

**Files:**
- Modify: `src/queue/store.ts`
- Create: `tests/queue/store-list.test.ts`

**Interfaces:**
- Consumes: Task 6 store + `encodeJobCursor`/`decodeJobCursor`.
- Produces: `listJobs({ status?, cursor?, limit }): { items: JobRecord[]; nextCursor?: string; total: number }` — newest-first (`created_at DESC, id ASC`), optional `status` filter, base64url keyset cursor, fetch-one-extra to detect `nextCursor`, malformed cursor treated as page 1 (mirrors `listSessions`, `src/session/store.ts:218`).

- [ ] **Step 1: Write the failing test**

`tests/queue/store-list.test.ts`:
```typescript
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

async function seed(n: number) {
  const store = createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {});
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(store.enqueue({ kind: JobKind.Crew, payload: i }).id);
    await Bun.sleep(1);
  }
  return { store, ids };
}

test('listJobs pages newest-first with a working keyset cursor', async () => {
  const { store, ids } = await seed(5);
  const p1 = store.listJobs({ limit: 2 });
  expect(p1.items.map((j) => j.id)).toEqual([ids[4], ids[3]]);
  expect(p1.total).toBe(5);
  expect(p1.nextCursor).toBeDefined();
  const p2 = store.listJobs({ limit: 2, cursor: p1.nextCursor });
  expect(p2.items.map((j) => j.id)).toEqual([ids[2], ids[1]]);
  const p3 = store.listJobs({ limit: 2, cursor: p2.nextCursor });
  expect(p3.items.map((j) => j.id)).toEqual([ids[0]]);
  expect(p3.nextCursor).toBeUndefined();
  store.close();
});

test('listJobs filters by status', async () => {
  const { store } = await seed(3);
  store.claimNext();
  store.markDone(store.claimNext()!.id, null);
  const running = store.listJobs({ status: JobStatus.Running, limit: 10 });
  expect(running.items.every((j) => j.status === JobStatus.Running)).toBe(true);
  const done = store.listJobs({ status: JobStatus.Done, limit: 10 });
  expect(done.items).toHaveLength(1);
  store.close();
});

test('a malformed cursor degrades to page 1', async () => {
  const { store, ids } = await seed(2);
  const page = store.listJobs({ limit: 10, cursor: 'not-base64-!!' });
  expect(page.items.map((j) => j.id)).toEqual([ids[1], ids[0]]);
  store.close();
});
```

- [ ] **Step 2: Run — verify it fails**

`bun test tests/queue/store-list.test.ts` → FAIL.

- [ ] **Step 3: Implement `listJobs`**

```typescript
  function listJobs(q: {
    status?: JobStatus;
    cursor?: string;
    limit: number;
  }): { items: JobRecord[]; nextCursor?: string; total: number } {
    const statusClause = q.status ? 'AND status = ?' : '';
    const statusArgs: (string | number)[] = q.status ? [q.status] : [];

    const totalRow = db
      .query(`SELECT COUNT(*) as n FROM jobs WHERE 1 = 1 ${statusClause}`)
      .get(...statusArgs) as { n: number };

    const cursor = q.cursor ? decodeJobCursor(q.cursor) : undefined;
    const cursorClause = cursor
      ? 'AND (created_at < ? OR (created_at = ? AND id > ?))'
      : '';
    const cursorArgs: (string | number)[] = cursor
      ? [cursor.createdAt, cursor.createdAt, cursor.id]
      : [];

    const rows = db
      .query(
        `SELECT * FROM jobs WHERE 1 = 1 ${statusClause} ${cursorClause}
         ORDER BY created_at DESC, id ASC LIMIT ?`,
      )
      .all(...statusArgs, ...cursorArgs, q.limit + 1) as JobRowRaw[];

    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const items = page.map(toJobRecord);
    const lastRaw = page[page.length - 1];
    const nextCursor =
      hasMore && lastRaw
        ? encodeJobCursor(lastRaw.created_at, lastRaw.id)
        : undefined;
    return { items, nextCursor, total: totalRow.n };
  }
```
Add `listJobs,` to the returned object.

- [ ] **Step 4: Run — verify it passes**

`bun test tests/queue/store-list.test.ts` → PASS (3 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run typecheck && bun run lint:file -- src/queue/store.ts tests/queue/store-list.test.ts
git add src/queue/store.ts tests/queue/store-list.test.ts
git commit -m "feat(queue): listJobs keyset page + status filter (Slice 24 Incr 2)"
```

