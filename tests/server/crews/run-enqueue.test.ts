import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCrew } from '../../../crews/index.ts';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobKind } from '../../../src/queue/types.ts';
import { handleCrewRun } from '../../../src/server/crews/run.ts';
import { createJobDispatch } from '../../../src/server/jobs/dispatch.ts';
import { getWorkflow } from '../../../workflows/index.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'crew-enqueue-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function tempStore() {
  return createJobStore(
    { path: mkdtempSync(join(tmpdir(), 'crew-enqueue-jobs-')) },
    {},
  );
}

function runReq(name: string, body: unknown): Request {
  return new Request(`http://localhost/api/crews/${name}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('handleCrewRun enqueues a JobKind.Crew job carrying the returned runId', async () => {
  const jobStore = tempStore();
  const res = await handleCrewRun(
    runReq('research-crew', { input: 'AI' }),
    { runsRoot: root, jobStore },
    'research-crew',
  );
  const { runId } = (await res.json()) as { runId: string };

  const { items } = jobStore.listJobs({ status: undefined, limit: 10 });
  expect(items).toHaveLength(1);
  const job = items[0];
  expect(job?.kind).toBe(JobKind.Crew);
  expect(job?.runId).toBe(runId);
  jobStore.close();
});

test('the enqueued crew job is dispatch-executable — it routes to runCrewTurn with the job runId, def, and input', async () => {
  const jobStore = tempStore();
  const res = await handleCrewRun(
    runReq('research-crew', { input: 'AI' }),
    { runsRoot: root, jobStore },
    'research-crew',
  );
  const { runId } = (await res.json()) as { runId: string };
  const job = jobStore.listJobs({ limit: 10 }).items[0];
  expect(job).toBeDefined();
  if (!job) throw new Error('no job enqueued');

  // The pool would run the executor T16 built for this kind — prove the seam:
  // the persisted payload validates and threads the pre-minted runId through.
  const seen: { input: string; runId: string; def: unknown }[] = [];
  const dispatch = createJobDispatch({
    getCrew,
    getWorkflow,
    runCrewTurn: async ({ def, input, runId: rid }) => {
      seen.push({ input, runId: rid, def });
    },
    runWorkflowTurn: async () => {},
    runModelPull: async () => {},
    runChatTurn: async () => ({}) as never,
    runBuilderTurn: async () => ({}) as never,
  });
  await dispatch(JobKind.Crew)(job, new AbortController().signal);
  expect(seen).toEqual([{ input: 'AI', runId, def: getCrew('research-crew') }]);
  jobStore.close();
});
