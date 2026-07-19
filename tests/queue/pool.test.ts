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
const waitFor = async (p: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (p()) return;
    await Bun.sleep(10);
  }
  throw new Error('timeout waiting for condition');
};

test('the pool claims, dispatches, and marks a job Done with its result', async () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: { n: 2 } });
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => async (j) => ({
      doubled: (j.payload as { n: number }).n * 2,
    }),
    pollMs: 10,
  });
  pool.start();
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Done);
  expect(store.getJob(job.id)?.result).toEqual({ doubled: 4 });
  await pool.stop();
  store.close();
});

test('concurrency bounds the number of jobs in flight at once', async () => {
  const store = tempStore();
  for (let i = 0; i < 4; i++) store.enqueue({ kind: JobKind.Crew, payload: i });
  let inFlight = 0;
  let peak = 0;
  const pool = createWorkerPool({
    store,
    concurrency: 2,
    dispatch: () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(40);
      inFlight--;
    },
    pollMs: 5,
  });
  pool.start();
  await waitFor(
    () => store.listJobs({ status: JobStatus.Done, limit: 10 }).total === 4,
    5000,
  );
  expect(peak).toBeLessThanOrEqual(2);
  await pool.stop();
  store.close();
});

test('cancel aborts an in-flight job and marks it Canceled', async () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => (_j, signal) =>
      new Promise((_res, rej) => {
        signal.addEventListener('abort', () => rej(new Error('aborted')), {
          once: true,
        });
      }),
    pollMs: 5,
  });
  pool.start();
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Running);
  expect(pool.cancel(job.id)).toBe(true);
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Canceled);
  await pool.stop();
  store.close();
});

test('a throwing (terminal) job is marked Failed with the explained title', async () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => async () => {
      throw new Error('boom'); // plain Error -> Terminal lane -> not retryable
    },
    pollMs: 5,
  });
  pool.start();
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Failed);
  // explain(plain Error).title === 'Unexpected error'
  expect(store.getJob(job.id)?.error).toBe('Unexpected error');
  await pool.stop();
  store.close();
});

test('a transient (retryable) failure re-queues the job instead of failing it', async () => {
  const store = tempStore();
  // maxAttempts high so it never exhausts during the test window.
  const job = store.enqueue({
    kind: JobKind.Chat,
    payload: 'x',
    maxAttempts: 5,
  });
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => async () => {
      throw Object.assign(new Error('conn reset'), { code: 'ECONNRESET' }); // Transient
    },
    pollMs: 5,
  });
  pool.start();
  // After the first failure markFailed re-queues (status back to Queued with a
  // future available_at from the backoff), proving retryable=true was threaded.
  await waitFor(() => {
    const j = store.getJob(job.id);
    return j !== undefined && j.attempts >= 1 && j.status === JobStatus.Queued;
  });
  await pool.stop();
  store.close();
});

test('activeCount reflects the number of executing jobs', async () => {
  const store = tempStore();
  for (let i = 0; i < 2; i++) store.enqueue({ kind: JobKind.Crew, payload: i });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const pool = createWorkerPool({
    store,
    concurrency: 2,
    dispatch: () => async () => {
      await gate;
    },
    pollMs: 5,
  });
  expect(pool.activeCount()).toBe(0);
  pool.start();
  await waitFor(() => pool.activeCount() === 2);
  release();
  await waitFor(
    () => store.listJobs({ status: JobStatus.Done, limit: 10 }).total === 2,
  );
  await waitFor(() => pool.activeCount() === 0);
  await pool.stop();
  store.close();
});

test('stop() drains: awaits an in-flight non-abortable job then marks the straggler Interrupted', async () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: 1 });
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    // Ignores the abort signal — a straggler that stop() must await then reconcile.
    dispatch: () => async () => {
      await Bun.sleep(50);
    },
    pollMs: 5,
  });
  pool.start();
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Running);
  await pool.stop(); // must resolve (not hang) after the in-flight job settles
  expect(store.getJob(job.id)?.status).toBe(JobStatus.Interrupted);
  store.close();
});

test('an empty queue does not busy-spin claimNext', async () => {
  const store = tempStore();
  let claims = 0;
  const realClaim = store.claimNext.bind(store);
  store.claimNext = (now?: number) => {
    claims++;
    return realClaim(now);
  };
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => async () => undefined,
    pollMs: 50,
  });
  pool.start();
  await Bun.sleep(260);
  await pool.stop();
  // ~260ms / 50ms poll ≈ 5-6 claims; a busy-spin would be thousands.
  expect(claims).toBeLessThan(20);
  store.close();
});
