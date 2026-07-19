import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobStore } from '../../../src/queue/store.ts';
import { JobStatus } from '../../../src/queue/types.ts';
import { handleJobEnqueue } from '../../../src/server/jobs/enqueue.ts';

const deps = () => ({
  jobStore: createJobStore({ path: mkdtempSync(join(tmpdir(), 'jobs-')) }, {}),
  runsRoot: mkdtempSync(join(tmpdir(), 'runs-')),
});

test('POST /api/jobs enqueues and returns 202 {jobId, runId}', async () => {
  const d = deps();
  const res = await handleJobEnqueue(
    new Request('http://x/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'crew',
        payload: { name: 'c', input: 'go' },
      }),
    }),
    d as never,
  );
  expect(res.status).toBe(202);
  const body = (await res.json()) as { jobId: string; runId: string };
  expect(body.jobId).toMatch(/^job-/);
  expect(body.runId).toMatch(/^run-/);
  expect(d.jobStore.getJob(body.jobId)?.status).toBe(JobStatus.Queued);
});

test('POST /api/jobs 400s an invalid body', async () => {
  const d = deps();
  const res = await handleJobEnqueue(
    new Request('http://x/api/jobs', { method: 'POST', body: '{}' }),
    d as never,
  );
  expect(res.status).toBe(400);
});

test('POST /api/jobs resolves the pull provider SERVER-SIDE and embeds it in the persisted payload', async () => {
  const d = deps();
  const resolveProvider = () => 'hf' as never;
  const res = await handleJobEnqueue(
    new Request('http://x/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'pull',
        // a client-supplied `provider` here must be IGNORED — the route
        // resolves it itself and never trusts this value.
        payload: {
          runtime: 'Ollama',
          modelRef: 'llama3',
          provider: 'client-supplied-bogus',
        },
      }),
    }),
    { ...d, resolveProvider } as never,
  );
  expect(res.status).toBe(202);
  const body = (await res.json()) as { jobId: string };
  const job = d.jobStore.getJob(body.jobId);
  expect((job?.payload as { provider: string }).provider).toBe('hf');
});

test('POST /api/jobs 404s a pull whose model is unresolvable in the catalog', async () => {
  const d = deps();
  const resolveProvider = () => undefined;
  const res = await handleJobEnqueue(
    new Request('http://x/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'pull',
        payload: { runtime: 'Ollama', modelRef: 'unknown-model' },
      }),
    }),
    { ...d, resolveProvider } as never,
  );
  expect(res.status).toBe(404);
});

test('POST /api/jobs 429s once the injected run-rate limiter is over cap (Slice 24 Incr 5, item 2)', async () => {
  const d = deps();
  const runLimiter = { allow: () => false };
  const res = await handleJobEnqueue(
    new Request('http://x/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'crew',
        payload: { name: 'c', input: 'go' },
      }),
    }),
    { ...d, runLimiter } as never,
  );
  expect(res.status).toBe(429);
});

test('POST /api/jobs stays within the limit when the injected limiter allows it', async () => {
  const d = deps();
  const runLimiter = { allow: () => true };
  const res = await handleJobEnqueue(
    new Request('http://x/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'crew',
        payload: { name: 'c', input: 'go' },
      }),
    }),
    { ...d, runLimiter } as never,
  );
  expect(res.status).toBe(202);
});
