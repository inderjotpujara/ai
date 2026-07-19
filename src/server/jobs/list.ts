import { ZodError } from 'zod';
import {
  JobListQuerySchema,
  JobListResponseSchema,
} from '../../contracts/index.ts';
import type { JobStore } from '../../queue/store.ts';
import type { JobStatus } from '../../queue/types.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { toJobDto } from './map.ts';

export type JobListDeps = { jobStore: JobStore };

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
 * `GET /api/jobs?status=&cursor=&limit=` — keyset-paginated job list, backed
 * directly by `JobStore.listJobs`'s SQL keyset page (byte-for-byte
 * `RunListResponseSchema`'s shape). A malformed query (bad `limit`/`status`)
 * is rejected with a 400 rather than bubbling to a 500.
 */
export function handleJobList(
  params: URLSearchParams,
  deps: JobListDeps,
): Response {
  let query: ReturnType<typeof JobListQuerySchema.parse>;
  try {
    query = JobListQuerySchema.parse({
      status: params.get('status') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
      limit: params.get('limit') ?? undefined,
    });
  } catch (err) {
    if (err instanceof ZodError) return json({ error: 'bad request' }, 400);
    throw err;
  }

  const { items, nextCursor, total } = deps.jobStore.listJobs({
    // JobStatusWire (wire) <-> JobStatus (queue) are isomorphic string enums
    // guarded by job-kind-parity.test.ts; see enqueue.ts's cast for the same
    // idiom applied to `kind`.
    status: query.status as unknown as JobStatus | undefined,
    cursor: query.cursor,
    limit: query.limit,
  });

  return json(
    JobListResponseSchema.parse({
      items: items.map(toJobDto),
      nextCursor,
      total,
    }),
    200,
  );
}
