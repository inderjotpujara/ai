import { JobStatus } from '../../queue/types.ts';
import { json, type ServerDeps } from '../app.ts';

/**
 * Cancel a job. A Running job is aborted via the pool's per-job
 * AbortController (`pool.cancel`, which also markCanceled's it); a Queued job
 * has no in-flight controller, so it is canceled directly on the store; a
 * terminal job is a no-op (`canceled:false`). Unknown id → 404.
 */
export function handleJobCancel(id: string, deps: ServerDeps): Response {
  const job = deps.jobStore.getJob(id);
  if (!job) return json({ error: 'not found' }, 404);
  if (job.status === JobStatus.Running) {
    return json({ canceled: deps.pool.cancel(id) }, 200);
  }
  if (job.status === JobStatus.Queued) {
    deps.jobStore.markCanceled(id);
    return json({ canceled: true }, 200);
  }
  return json({ canceled: false }, 200); // already terminal
}
