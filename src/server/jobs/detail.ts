import type { JobStore } from '../../queue/store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { toJobDto } from './map.ts';

export type JobDetailDeps = { jobStore: JobStore };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/jobs/:id` — full `JobDTO`, or 404 for an unknown id. */
export function handleJobDetail(id: string, deps: JobDetailDeps): Response {
  const job = deps.jobStore.getJob(id);
  if (!job) return json({ error: 'not found' }, 404);
  return json(toJobDto(job), 200);
}
