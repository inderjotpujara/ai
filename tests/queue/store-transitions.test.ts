import { expect, test } from 'bun:test';
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
  const job = store.enqueue({
    kind: JobKind.Crew,
    payload: 'x',
    maxAttempts: 2,
  });
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
  const job = store.enqueue({
    kind: JobKind.Crew,
    payload: 'x',
    maxAttempts: 1,
  });
  store.claimNext(); // attempts -> 1 == max
  store.markFailed(job.id, 'boom again', true); // retryable but no attempts left
  const failed = store.getJob(job.id);
  expect(failed?.status).toBe(JobStatus.Failed); // 1 == max, terminal
  expect(failed?.error).toBe('boom again');
  store.close();
});

test('markFailed with retryable=false fails terminally on the first attempt', () => {
  const store = tempStore();
  const job = store.enqueue({
    kind: JobKind.Crew,
    payload: 'x',
    maxAttempts: 5,
  });
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
