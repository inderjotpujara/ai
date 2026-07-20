import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunOrigin } from '../../../src/contracts/enums.ts';
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

// I6: a retry must carry the ORIGINAL job's provenance forward — otherwise a
// webhook/schedule-origin job silently re-attributes to daemon (drops off the
// ?origin= facet) and a chained job resets to chainDepth 0 (escapes the cap).
test('retry of an origin=webhook job keeps origin + chainDepth', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({
    kind: JobKind.Crew,
    payload: { input: 'go' },
    maxAttempts: 1,
    origin: RunOrigin.Webhook,
    chainDepth: 2,
  });
  d.jobStore.claimNext();
  d.jobStore.markFailed(job.id, 'boom', false); // terminal Failed
  const res = await handleJobRetry(job.id, d);
  expect(res.status).toBe(202);
  const body = (await res.json()) as { jobId: string; runId: string };
  const retry = d.jobStore.getJob(body.jobId);
  expect(retry?.origin).toBe(RunOrigin.Webhook);
  expect(retry?.chainDepth).toBe(2);
  expect(retry?.retriedFrom).toBe(job.id);
});

test('retry of a chainDepth=3 schedule job keeps chainDepth=3', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({
    kind: JobKind.Workflow,
    payload: { input: 'go' },
    maxAttempts: 1,
    origin: RunOrigin.Schedule,
    chainDepth: 3,
  });
  d.jobStore.claimNext();
  d.jobStore.markFailed(job.id, 'boom', false);
  const res = await handleJobRetry(job.id, d);
  expect(res.status).toBe(202);
  const body = (await res.json()) as { jobId: string; runId: string };
  const retry = d.jobStore.getJob(body.jobId);
  expect(retry?.origin).toBe(RunOrigin.Schedule);
  expect(retry?.chainDepth).toBe(3);
});

test('retry of a plain (no-origin) job leaves origin undefined + chainDepth 0', async () => {
  const d = deps();
  const job = d.jobStore.enqueue({
    kind: JobKind.Chat,
    payload: 1,
    maxAttempts: 1,
  });
  d.jobStore.claimNext();
  d.jobStore.markFailed(job.id, 'boom', false);
  const res = await handleJobRetry(job.id, d);
  const body = (await res.json()) as { jobId: string };
  const retry = d.jobStore.getJob(body.jobId);
  expect(retry?.origin).toBeUndefined();
  expect(retry?.chainDepth).toBe(0);
});
