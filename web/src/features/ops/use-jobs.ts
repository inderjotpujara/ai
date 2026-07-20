import type { JobListResponse } from '@contracts';
import { JobListResponseSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';

export type JobsQuery = { status: string; kind: string; priority: string };
const emptyQuery: JobsQuery = { status: '', kind: '', priority: '' };

function toJobsPath(query: JobsQuery, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status); // server-side facet
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}

/** Job queue list: mirrors `RunsArea`'s `cursors[]`/`page`/`nextCursor` keyset
 *  pattern against `GET /api/jobs`. Only `status` is a server-side facet
 *  (`JobListQuerySchema`); `kind`/`priority` narrow the returned page
 *  client-side. `refresh()` re-fetches the current page in place — used by
 *  optimistic job actions (Task 30) to reconcile after a mutation. */
export function useJobs() {
  const [query, setQuery] = useState<JobsQuery>(emptyQuery);
  const [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<JobListResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadTick, setReloadTick] = useState(0);
  const cursor = cursors.at(-1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick isn't read in the body — it's a bump-to-refetch trigger for refresh().
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch(toJobsPath(query, cursor), { schema: JobListResponseSchema })
      .then((result) => {
        if (cancelled) return;
        // kind/priority are client-side facets (server filters status only).
        const items = result.items.filter(
          (j) =>
            (!query.kind || j.kind === query.kind) &&
            (!query.priority || j.priority === query.priority),
        );
        setPage({ ...result, items });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(err instanceof Error ? err.message : 'failed to load jobs');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, cursor, reloadTick]);

  return {
    page,
    error,
    query,
    setQuery: (patch: Partial<JobsQuery>) => {
      setCursors([]);
      setQuery((prev) => ({ ...prev, ...patch }));
    },
    goNext: () => {
      const next = page?.nextCursor;
      if (next) setCursors((prev) => [...prev, next]);
    },
    goFirst: () => setCursors([]),
    refresh: () => setReloadTick((t) => t + 1),
  };
}
