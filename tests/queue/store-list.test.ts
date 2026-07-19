import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';

async function seed(n: number) {
  const store = createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'jobs-')) },
    {},
  );
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(store.enqueue({ kind: JobKind.Crew, payload: i }).id);
    await Bun.sleep(1);
  }
  return { store, ids };
}

/** Indexes a known-in-bounds array without `!` (biome's noNonNullAssertion). */
function at(ids: string[], i: number): string {
  const id = ids[i];
  if (id === undefined) throw new Error(`seed id ${i} missing`);
  return id;
}

test('listJobs pages newest-first with a working keyset cursor', async () => {
  const { store, ids } = await seed(5);
  const p1 = store.listJobs({ limit: 2 });
  expect(p1.items.map((j) => j.id)).toEqual([at(ids, 4), at(ids, 3)]);
  expect(p1.total).toBe(5);
  expect(p1.nextCursor).toBeDefined();
  const p2 = store.listJobs({ limit: 2, cursor: p1.nextCursor });
  expect(p2.items.map((j) => j.id)).toEqual([at(ids, 2), at(ids, 1)]);
  const p3 = store.listJobs({ limit: 2, cursor: p2.nextCursor });
  expect(p3.items.map((j) => j.id)).toEqual([at(ids, 0)]);
  expect(p3.nextCursor).toBeUndefined();
  store.close();
});

test('listJobs filters by status', async () => {
  const { store } = await seed(3);
  store.claimNext();
  const claimed = store.claimNext();
  if (!claimed) throw new Error('expected a second claimable job');
  store.markDone(claimed.id, null);
  const running = store.listJobs({ status: JobStatus.Running, limit: 10 });
  expect(running.items.every((j) => j.status === JobStatus.Running)).toBe(true);
  const done = store.listJobs({ status: JobStatus.Done, limit: 10 });
  expect(done.items).toHaveLength(1);
  store.close();
});

test('a malformed cursor degrades to page 1', async () => {
  const { store, ids } = await seed(2);
  const page = store.listJobs({ limit: 10, cursor: 'not-base64-!!' });
  expect(page.items.map((j) => j.id)).toEqual([at(ids, 1), at(ids, 0)]);
  store.close();
});
