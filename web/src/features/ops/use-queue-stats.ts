import type { QueueStatsDTO } from '@contracts';
import { QueueStatsDtoSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch, notifyConfig } from '../../shared/contract/client.ts';

/** Queue health poll for the Overview tab (Slice 25b Incr 6). Same
 *  fetch-on-mount + `setInterval` shape as `useDaemonStatus`, against
 *  `GET /api/queue/stats`. `stats.counts` is a PARTIAL map
 *  (`QueueStatsDtoSchema`'s `z.partialRecord`) — a status absent from
 *  `counts` means zero; callers must read `counts[status] ?? 0`, never
 *  assume every `JobStatusWire` key is present. */
export function useQueueStats() {
  const [stats, setStats] = useState<QueueStatsDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiFetch('/queue/stats', { schema: QueueStatsDtoSchema })
        .then((s) => !cancelled && setStats(s))
        .catch(
          (e: unknown) =>
            !cancelled && setError(e instanceof Error ? e.message : 'failed'),
        );
    };
    load();
    const id = setInterval(load, notifyConfig().pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return { stats, error };
}
