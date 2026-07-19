import { JobLaunchResponseSchema } from '../../contracts/index.ts';
import { recordJobRetry } from '../../daemon/spans.ts';
import type { JobStore } from '../../queue/store.ts';
import { JobStatus } from '../../queue/types.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun } from '../../run/run-store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type JobRetryDeps = { jobStore: JobStore; runsRoot: string };

const RETRYABLE = new Set<JobStatus>([
  JobStatus.Failed,
  JobStatus.Canceled,
  JobStatus.Interrupted,
]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `POST /api/jobs/:id/retry` — lineage-preserving re-enqueue (§11). Loads the
 * job; only `Failed`/`Canceled`/`Interrupted` are retryable (a `Done`/`Queued`/
 * `Running` job, or an unknown id, → 404 — terminal-mismatch collapses to 404,
 * so a caller can never distinguish "no such job" from "not in a retryable
 * state", the same non-leaking idiom the detail/stream routes use). Re-enqueues
 * a FRESH job with the SAME `kind`+`payload`, a fresh runId + pre-created run
 * dir (so an immediate `/api/runs/:runId/stream` never 404s, mirroring the
 * enqueue path), stamping `retriedFrom: <originalId>` (the T1 lineage column)
 * so the Jobs drawer can back-link the retry to its origin. Session-guarded like
 * the other job mutations (cancel) — NOT trusted-local.
 */
export async function handleJobRetry(
  id: string,
  deps: JobRetryDeps,
): Promise<Response> {
  const job = deps.jobStore.getJob(id);
  if (!job || !RETRYABLE.has(job.status))
    return json({ error: 'not found' }, 404);
  const runId = newRunId();
  await createRun(deps.runsRoot, runId);
  const retry = deps.jobStore.enqueue({
    kind: job.kind,
    payload: job.payload,
    retriedFrom: job.id,
    runId,
  });
  recordJobRetry(retry);
  return json(JobLaunchResponseSchema.parse({ jobId: retry.id, runId }), 202);
}
