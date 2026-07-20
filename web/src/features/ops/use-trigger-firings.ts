import type { TriggerFiringListResponse } from '@contracts';
import { TriggerFiringListResponseSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';

function toFiringsPath(triggerId: string, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs
    ? `/triggers/${triggerId}/firings?${qs}`
    : `/triggers/${triggerId}/firings`;
}

/** One trigger's firing-history keyset pager: mirrors `useJobs`'s
 *  `cursors[]`/`page`/`nextCursor` pattern against
 *  `GET /api/triggers/:id/firings`, byte-for-byte `JobListResponseSchema`'s
 *  page shape (`TriggerFiringListResponseSchema`). */
export function useTriggerFirings(triggerId: string) {
  const [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<TriggerFiringListResponse | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const cursor = cursors.at(-1);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch(toFiringsPath(triggerId, cursor), {
      schema: TriggerFiringListResponseSchema,
    })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(
            err instanceof Error ? err.message : 'failed to load firings',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [triggerId, cursor]);

  return {
    page,
    error,
    goNext: () => {
      const next = page?.nextCursor;
      if (next) setCursors((prev) => [...prev, next]);
    },
    goFirst: () => setCursors([]),
  };
}
