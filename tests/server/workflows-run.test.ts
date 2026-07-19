import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../src/queue/store.ts';
import { JobKind, JobStatus } from '../../src/queue/types.ts';
import { handleWorkflowRun } from '../../src/server/workflows/run.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workflowrun-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function tempStore() {
  return createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'workflowrun-jobs-')) },
    {},
  );
}

function runReq(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/workflows/${id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('200 + {runId}, pre-creates dir, ENQUEUES a workflow job (does not run inline)', async () => {
  const jobStore = tempStore();
  const res = await handleWorkflowRun(
    runReq('fetch-then-summarize', { input: 'AI' }),
    { runsRoot: root, jobStore },
    'fetch-then-summarize',
  );
  expect(res.status).toBe(200);
  const { runId } = (await res.json()) as { runId: string };
  expect(runId.startsWith('run-')).toBe(true);
  expect(existsSync(join(root, runId))).toBe(true); // dir exists before we streamed

  const { items } = jobStore.listJobs({ limit: 10 });
  expect(items).toHaveLength(1);
  expect(items[0]?.kind).toBe(JobKind.Workflow);
  expect(items[0]?.status).toBe(JobStatus.Queued);
  expect(items[0]?.runId).toBe(runId); // job.runId === run dir id
  expect(items[0]?.payload).toEqual({
    name: 'fetch-then-summarize',
    input: 'AI',
  });
  jobStore.close();
});

test('unknown workflow → 404 (no dir created, nothing enqueued)', async () => {
  const jobStore = tempStore();
  const res = await handleWorkflowRun(
    runReq('nope', { input: 'x' }),
    { runsRoot: root, jobStore },
    'nope',
  );
  expect(res.status).toBe(404);
  expect(jobStore.listJobs({ limit: 10 }).items).toHaveLength(0);
  jobStore.close();
});

test('malformed body → 400 (nothing enqueued)', async () => {
  const jobStore = tempStore();
  const res = await handleWorkflowRun(
    runReq('fetch-then-summarize', { wrong: 1 }),
    { runsRoot: root, jobStore },
    'fetch-then-summarize',
  );
  expect(res.status).toBe(400);
  expect(jobStore.listJobs({ limit: 10 }).items).toHaveLength(0);
  jobStore.close();
});
