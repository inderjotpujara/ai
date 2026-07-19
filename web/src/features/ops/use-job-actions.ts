import type { JobDTO } from '@contracts';
import { JobLaunchResponseSchema } from '@contracts';
import { z } from 'zod';
import { apiFetch } from '../../shared/contract/client.ts';

/** `POST /api/jobs/:id/cancel` response — `src/server/jobs/cancel.ts`
 *  (`{canceled: boolean}`, not `JobLaunchResponseSchema` — cancel never
 *  mints a job/run). */
const CancelResponseSchema = z.object({ canceled: z.boolean() });

/** Job lifecycle actions (D2). `resume` re-enqueues the EXISTING run so
 *  dispatch continues from the last completed DAG node (checkpoint), NOT a
 *  fresh restart — it posts `{ kind, resume: runId }` to `POST /api/jobs`
 *  (`src/server/jobs/enqueue.ts`'s resume branch). `retry` is the
 *  lineage-preserving server route (`src/server/jobs/retry.ts`, §11) — only
 *  `failed`/`canceled`/`interrupted` jobs are retryable server-side; an
 *  out-of-state retry 404s. Each triggers `refresh()` to reconcile the
 *  optimistic status flip the caller (drawer/table) already applied. */
export function useJobActions(refresh: () => void) {
  async function cancel(job: JobDTO): Promise<void> {
    await apiFetch(`/jobs/${job.id}/cancel`, {
      method: 'POST',
      body: {},
      schema: CancelResponseSchema,
    });
    refresh();
  }

  async function resume(job: JobDTO): Promise<void> {
    await apiFetch('/jobs', {
      method: 'POST',
      body: { kind: job.kind, resume: job.runId },
      schema: JobLaunchResponseSchema,
    });
    refresh();
  }

  async function retry(job: JobDTO): Promise<void> {
    await apiFetch(`/jobs/${job.id}/retry`, {
      method: 'POST',
      body: {},
      schema: JobLaunchResponseSchema,
    });
    refresh();
  }

  return { cancel, resume, retry };
}
