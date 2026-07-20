import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind } from '../../../src/queue/types.ts';
import { handleJobRetry } from '../../../src/server/jobs/retry.ts';

function deps() {
  return {
    jobStore: createJobStore(
      { path: mkdtempSync(join(tmpdir(), 'jobs-')) },
      {},
    ),
    runsRoot: mkdtempSync(join(tmpdir(), 'runs-')),
  };
}

async function failedJob(d: ReturnType<typeof deps>) {
  const job = d.jobStore.enqueue({
    kind: JobKind.Crew,
    payload: { input: 'go' },
    maxAttempts: 1,
  });
  d.jobStore.claimNext();
  d.jobStore.markFailed(job.id, 'boom', false); // terminal Failed
  return job;
}

test('retry re-enqueues same kind+payload with retriedFrom lineage + fresh runId', async () => {
  const d = deps();
  const orig = await failedJob(d);
  const res = await handleJobRetry(orig.id, d);
  expect(res.status).toBe(202);
  const body = (await res.json()) as { jobId: string; runId: string };
  const retry = d.jobStore.getJob(body.jobId);
  expect(retry?.kind).toBe(JobKind.Crew);
  expect(retry?.payload).toEqual({ input: 'go' });
  expect(retry?.retriedFrom).toBe(orig.id);
  expect(retry?.runId).toBe(body.runId);
  expect(body.runId).not.toBe(orig.runId); // fresh run dir
});

test('a Canceled job is retryable', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Chat, payload: 1 });
  d.jobStore.markCanceled(job.id);
  const res = await handleJobRetry(job.id, d);
  expect(res.status).toBe(202);
});

test('an Interrupted job is retryable', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Chat, payload: 1 });
  d.jobStore.markInterrupted(job.id);
  const res = await handleJobRetry(job.id, d);
  expect(res.status).toBe(202);
});

test('an unknown job id is 404', async () => {
  expect((await handleJobRetry('job-nope', deps())).status).toBe(404);
});

test('a Done/Queued job is not retryable → 404', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({ kind: JobKind.Chat, payload: 1 }); // Queued
  expect((await handleJobRetry(job.id, d)).status).toBe(404);
});

test('retry honors the run-dir rate limiter → 429 (no run dir created)', async () => {
  const d = deps();
  const orig = await failedJob(d);
  // A limiter that refuses — retry is a run-launch path and MUST consult the
  // same process-shared cap the enqueue/crew/workflow/pull routes do, or a
  // paired remote device could spam createRun unbounded (Fable capstone MEDIUM).
  const res = await handleJobRetry(orig.id, {
    ...d,
    runLimiter: { allow: () => false },
  });
  expect(res.status).toBe(429);
  // The 429 short-circuits BEFORE createRun/enqueue: no retry job was minted.
  expect(d.jobStore.listJobs({ limit: 10 }).items).toHaveLength(1); // only original
});
