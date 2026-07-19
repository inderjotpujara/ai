import type { DaemonStatusDTO } from '@contracts';
import { DaemonStatusDtoSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch, notifyConfig } from '../../shared/contract/client.ts';

/** Daemon liveness poll for the Overview tab (Slice 25b Incr 6). Mirrors
 *  `useJobs`'s cancelled-flag-guarded fetch-on-mount pattern, but on a plain
 *  `setInterval` (no query/cursor state to react to) — fetches
 *  `GET /api/daemon/status` on mount and every `notifyConfig().pollMs`. */
export function useDaemonStatus() {
  const [status, setStatus] = useState<DaemonStatusDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiFetch('/daemon/status', { schema: DaemonStatusDtoSchema })
        .then((s) => !cancelled && setStatus(s))
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
  return { status, error };
}
