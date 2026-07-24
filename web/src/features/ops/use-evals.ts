import type {
  EvalHealthListResponse,
  EvalHistoryListResponse,
} from '@contracts';
import {
  EvalHealthListResponseSchema,
  EvalHistoryListResponseSchema,
  EvalReevalResponseSchema,
} from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';

/** Per-artifact eval health rollup (Slice 32, Task 21): mirrors `useJobs`'s
 *  fetch-on-mount + tick-bump-to-refetch pattern (no query lib) against
 *  `GET /api/evals` (`src/server/evals/health.ts`). */
export function useEvals() {
  const [page, setPage] = useState<EvalHealthListResponse | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadTick, setReloadTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick isn't read in the body — it's a bump-to-refetch trigger for refresh().
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch('/evals', { schema: EvalHealthListResponseSchema })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(err instanceof Error ? err.message : 'failed to load evals');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  return { page, error, refresh: () => setReloadTick((t) => t + 1) };
}

/** One artifact's full `eval_history` trend (Task 21) — `GET /api/evals/:artifact`
 *  (`src/server/evals/history.ts`). Intended to be mounted only while its
 *  trend is expanded (the `JobDetailDrawer` conditional-mount idiom
 *  `evals-tab.tsx` reuses), so collapsing a row also cancels its fetch. */
export function useEvalHistory(artifact: string) {
  const [page, setPage] = useState<EvalHistoryListResponse | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/evals/${encodeURIComponent(artifact)}`, {
      schema: EvalHistoryListResponseSchema,
    })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'failed to load eval history',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artifact]);

  return { page, error };
}

/** "Re-eval now" action (Task 21): mirrors `useJobActions`'s POST +
 *  `refresh()` reconcile shape — the caller applies its own optimistic UI
 *  (a pending flag, same idiom as `JobsTab`'s `statusOverlay`) BEFORE
 *  calling these, then `refresh()` reconciles once the enqueue lands.
 *  `reevalArtifact` targets one artifact; `reevalAll` fires the mode:'all'
 *  sweep the same `/api/evals/reeval` route accepts. */
export function useReeval(refresh: () => void) {
  async function reevalArtifact(ref: string): Promise<void> {
    await apiFetch('/evals/reeval', {
      method: 'POST',
      body: { mode: 'artifact', ref },
      schema: EvalReevalResponseSchema,
    });
    refresh();
  }

  async function reevalAll(): Promise<void> {
    await apiFetch('/evals/reeval', {
      method: 'POST',
      body: { mode: 'all' },
      schema: EvalReevalResponseSchema,
    });
    refresh();
  }

  return { reevalArtifact, reevalAll };
}
