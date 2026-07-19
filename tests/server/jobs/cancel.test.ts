import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../../src/queue/types.ts';
import { handleJobCancel } from '../../../src/server/jobs/cancel.ts';

function deps() {
  return {
    jobStore: createJobStore(
      { path: mkdtempSync(join(tmpdir(), 'jobs-')) },
      {},
    ),
    pool: {
      cancel: () => true,
      activeCount: () => 0,
      start() {},
      stop: async () => {},
    },
  };
}

test('a Queued job cancels directly on the store', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'x' });
  const res = handleJobCancel(job.id, d as never);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ canceled: true });
  expect(d.jobStore.getJob(job.id)?.status).toBe(JobStatus.Canceled);
});

test('an already-terminal (Done) job returns canceled:false', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'x' });
  d.jobStore.claimNext();
  d.jobStore.markDone(job.id, null);
  const res = handleJobCancel(job.id, d as never);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ canceled: false });
});

test('an unknown job id is 404', () => {
  expect(handleJobCancel('job-nope', deps() as never).status).toBe(404);
});

test('a Running job cancels via the pool (fires the AbortController)', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Crew, payload: 'x' });
  d.jobStore.claimNext(); // -> Running
  const res = handleJobCancel(job.id, d as never);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ canceled: true });
});
