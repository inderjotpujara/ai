import { expect, test } from 'bun:test';
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

test('stats() self-consistency (sum(counts) === total) holds on every read under live pool churn', async () => {
  const store = tempStore();
  for (let i = 0; i < 40; i++)
    store.enqueue({ kind: JobKind.Chat, payload: i });
  const pool = createWorkerPool({
    store,
    concurrency: 4,
    pollMs: 1,
    dispatch: () => async () => ({ ok: true }),
  });
  pool.start();
  // Hammer stats() while the pool transitions rows underneath it, asserting
  // the sum(counts) === total invariant holds on every single read.
  for (let i = 0; i < 200; i++) {
    const s = store.stats();
    const sum = Object.values(s.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.total); // never off-by-one across a transition
    for (const v of Object.values(s.counts))
      expect(v).toBeGreaterThanOrEqual(0);
    await Bun.sleep(0);
  }
  await pool.stop();
  store.close();
});
