import type { A2aRemoteAddRequest, A2aRemoteTestRequest } from '@contracts';
import {
  A2aRemoteListResponseSchema,
  A2aRemoteTestResponseSchema,
} from '@contracts';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../shared/contract/client.ts';

const OkSchema = z.object({}).passthrough();

/** Federation tab (Slice 31 Incr 7, T24) — the CONSUME-side remote-agent CRUD:
 *  which remote peers this node delegates to (`GET/POST/DELETE /api/a2a/remotes`)
 *  plus the `/remotes/test` dry-run discover/pin preview. Mirrors `useDevices`'s
 *  cancelled-flag-guarded fetch-on-mount + tick-bump-to-refetch pattern; `add`
 *  and `remove` `refresh()` the list. `testRemote` is a dry-run — the store is
 *  untouched, so it deliberately does NOT refresh. */
export function useA2aRemotes() {
  const [remotes, setRemotes] = useState<
    z.infer<typeof A2aRemoteListResponseSchema>['remotes'] | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick isn't read in the body — it's a bump-to-refetch trigger for refresh().
  useEffect(() => {
    let cancelled = false;
    apiFetch('/a2a/remotes', { schema: A2aRemoteListResponseSchema })
      .then((r) => !cancelled && setRemotes(r.remotes))
      .catch(
        (e: unknown) =>
          !cancelled && setError(e instanceof Error ? e.message : 'failed'),
      );
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);
  return {
    remotes,
    error,
    refresh,
    addRemote: (body: A2aRemoteAddRequest) =>
      apiFetch('/a2a/remotes', {
        method: 'POST',
        body,
        schema: OkSchema,
      }).then(refresh),
    removeRemote: (name: string) =>
      apiFetch(`/a2a/remotes/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        body: {},
        schema: OkSchema,
      }).then(refresh),
    testRemote: (body: A2aRemoteTestRequest) =>
      apiFetch('/a2a/remotes/test', {
        method: 'POST',
        body,
        schema: A2aRemoteTestResponseSchema,
      }),
  };
}
