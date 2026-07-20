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

test('onSettled(Done) fires once on successful completion', async () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Crew, payload: { n: 1 } });
  const settled: Array<{ id: string; status: JobStatus }> = [];
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => async () => ({ ok: true }),
    pollMs: 5,
    onSettled: (j, s) => settled.push({ id: j.id, status: s }),
  });
  pool.start();
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Done);
  await Bun.sleep(20);
  expect(settled).toEqual([{ id: job.id, status: JobStatus.Done }]);
  await pool.stop();
  store.close();
});

test('onSettled(Failed) fires once on a terminal (non-retryable) failure', async () => {
  const store = tempStore();
  const job = store.enqueue({ kind: JobKind.Chat, payload: 'x' });
  const settled: Array<{ id: string; status: JobStatus }> = [];
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => async () => {
      throw new Error('boom'); // plain Error -> Terminal lane -> not retryable
    },
    pollMs: 5,
    onSettled: (j, s) => settled.push({ id: j.id, status: s }),
  });
  pool.start();
  await waitFor(() => store.getJob(job.id)?.status === JobStatus.Failed);
  await Bun.sleep(20);
  expect(settled).toEqual([{ id: job.id, status: JobStatus.Failed }]);
  await pool.stop();
  store.close();
});

test('onSettled is NOT called when markFailed re-queues for retry', async () => {
  const store = tempStore();
  const job = store.enqueue({
    kind: JobKind.Chat,
    payload: 'x',
    maxAttempts: 5, // never exhausts during the window -> stays Queued (retry)
  });
  const settled: JobStatus[] = [];
  const pool = createWorkerPool({
    store,
    concurrency: 1,
    dispatch: () => async () => {
      throw Object.assign(new Error('conn reset'), { code: 'ECONNRESET' });
    },
    pollMs: 5,
    onSettled: (_j, s) => settled.push(s),
  });
  pool.start();
  await waitFor(() => {
    const j = store.getJob(job.id);
    return j !== undefined && j.attempts >= 1 && j.status === JobStatus.Queued;
  });
  await Bun.sleep(20);
  expect(settled).toEqual([]); // a retry re-queue is NOT a terminal settle
  await pool.stop();
  store.close();
});

test('onSettled is NOT called when markDone throws (no phantom chain off an uncommitted done)', async () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Crew, payload: { n: 1 } });
  // markDone throws (persistence failure) -> the pool swallows it and leaves the
  // row Running; onSettled must NOT fire off a completion that never committed.
  store.markDone = () => {
    throw Object.assign(new Error('SQLITE_BUSY: injected'), {
      code: 'SQLITE_BUSY',
    });
  };
  const settled: JobStatus[] = [];
  let unhandled: unknown;
  const onUnhandled = (e: unknown) => {
    unhandled = e;
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const pool = createWorkerPool({
      store,
      concurrency: 1,
      dispatch: () => async () => ({ ok: true }),
      pollMs: 5,
      onSettled: (_j, s) => settled.push(s),
    });
    pool.start();
    // Give the job time to be claimed, run, and hit the throwing markDone.
    await Bun.sleep(120);
    expect(settled).toEqual([]); // no phantom fire
    expect(unhandled).toBeUndefined(); // the throw was swallowed, runOne did not reject
    await pool.stop();
    store.close();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('a throwing onSettled observer never wedges the claim loop', async () => {
  const store = tempStore();
  store.enqueue({ kind: JobKind.Crew, payload: { first: true } });
  const second = store.enqueue({
    kind: JobKind.Crew,
    payload: { first: false },
  });
  let calls = 0;
  let unhandled: unknown;
  const onUnhandled = (e: unknown) => {
    unhandled = e;
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const pool = createWorkerPool({
      store,
      concurrency: 1, // serialize so the first job's observer throws first
      dispatch: () => async () => ({ ok: true }),
      pollMs: 5,
      onSettled: () => {
        calls++;
        throw new Error('observer boom');
      },
    });
    pool.start();
    // The loop survived the throwing observer: the second job still reaches Done.
    await waitFor(() => store.getJob(second.id)?.status === JobStatus.Done);
    await Bun.sleep(20);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(unhandled).toBeUndefined();
    await pool.stop();
    store.close();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
