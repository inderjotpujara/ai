import { QueueStatsDtoSchema } from '../../contracts/index.ts';
import { recordQueueStatsRead } from '../../daemon/spans.ts';
import type { WorkerPool } from '../../queue/pool.ts';
import type { JobStore } from '../../queue/store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type QueueStatsDeps = {
  jobStore: JobStore;
  pool: Pick<WorkerPool, 'activeCount'>;
  queueConcurrency: number;
};

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
 * `GET /api/queue/stats` — queue health for the Overview tab. `counts`+`total`
 * come from the store's SINGLE race-free snapshot (§7.2); `activeCount` is the
 * pool's in-flight controller count, reported as a SEPARATE field (never
 * reconciled by arithmetic with the DB `running` count — they may transiently
 * differ, and the panel labels them "running rows" vs "active workers").
 */
export function handleQueueStats(deps: QueueStatsDeps): Response {
  const { counts, total } = deps.jobStore.stats();
  recordQueueStatsRead();
  return json(
    QueueStatsDtoSchema.parse({
      counts,
      total,
      activeCount: deps.pool.activeCount(),
      concurrency: deps.queueConcurrency,
    }),
    200,
  );
}
