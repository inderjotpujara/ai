import type { RunListResponse } from '@contracts';
import { RunKind, RunListResponseSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/** Free-form (server derives it from span attributes), but these are the
 *  values `run-dto.ts` actually emits — cover them as a facet, with an
 *  "All" escape hatch since new values can appear without a contract change. */
const OUTCOME_OPTIONS = ['answer', 'error', 'resource', 'gap', 'unknown'];

const DEGRADED_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'true', label: 'Degraded only' },
  { value: 'false', label: 'Clean only' },
];

/** Task 18 kind facet — every `RunKind` value plus an "All" escape hatch,
 *  feeding `?kind=` straight into `RunListQuerySchema.kind` (server-side
 *  `src/server/runs/list.ts`). */
const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: RunKind.Chat, label: 'chat' },
  { value: RunKind.Crew, label: 'crew' },
  { value: RunKind.Workflow, label: 'workflow' },
  { value: RunKind.Agent, label: 'agent' },
];

type Query = {
  search: string;
  outcome: string;
  degraded: string;
  kind: string;
};

const emptyQuery: Query = { search: '', outcome: '', degraded: '', kind: '' };

function toQueryString(query: Query, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.outcome) params.set('outcome', query.outcome);
  if (query.degraded) params.set('degraded', query.degraded);
  if (query.kind) params.set('kind', query.kind);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/runs?${qs}` : '/runs';
}

/** Runs history: search + outcome/degraded facets, cursor-paginated rows
 *  linking into `/runs/$runId`. Fetches `GET /api/runs` via `apiFetch`
 *  (plain request/response — not the SSE stream `useRunTrace` consumes). */
export function RunsArea() {
  const [query, setQuery] = useState<Query>(emptyQuery);
  const [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<RunListResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const cursor = cursors.at(-1);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch(toQueryString(query, cursor), { schema: RunListResponseSchema })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(err instanceof Error ? err.message : 'failed to load runs');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, cursor]);

  function updateQuery(patch: Partial<Query>) {
    setCursors([]);
    setQuery((prev) => ({ ...prev, ...patch }));
  }

  function goNext() {
    const next = page?.nextCursor;
    if (next) setCursors((prev) => [...prev, next]);
  }

  function goFirst() {
    setCursors([]);
  }

  return (
    <RegionErrorBoundary region="Runs">
      <section data-testid="area-runs" className="flex h-full flex-col p-8">
        <h1 className="font-mono text-lg text-[var(--color-fg)]">Runs</h1>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            data-testid="runs-search"
            type="search"
            placeholder="Search runs…"
            value={query.search}
            onChange={(e) => updateQuery({ search: e.target.value })}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
          />

          <select
            data-testid="runs-outcome-filter"
            aria-label="Filter by outcome"
            value={query.outcome}
            onChange={(e) => updateQuery({ outcome: e.target.value })}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)]"
          >
            <option value="">All outcomes</option>
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>

          <select
            data-testid="runs-degraded-filter"
            aria-label="Filter by degraded status"
            value={query.degraded}
            onChange={(e) => updateQuery({ degraded: e.target.value })}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)]"
          >
            {DEGRADED_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>

          <select
            data-testid="runs-kind-filter"
            aria-label="Filter by run kind"
            value={query.kind}
            onChange={(e) => updateQuery({ kind: e.target.value })}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)]"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Runs</strong> failed to
            load. {error}
          </div>
        )}

        {!error && page && page.items.length === 0 && (
          <p className="mt-6 text-sm text-[var(--color-muted)]">No runs yet</p>
        )}

        {!error && page && page.items.length > 0 && (
          <ul className="mt-4 flex flex-1 flex-col gap-2 overflow-auto">
            {page.items.map((item) => (
              <li key={item.id}>
                <Link
                  to="/runs/$runId"
                  params={{ runId: item.id }}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-fg)] hover:border-[var(--color-accent)]"
                >
                  <span className="text-[var(--color-fg)]">{item.id}</span>
                  <span className="text-[var(--color-muted)]">
                    {item.outcome}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {item.lifecycle}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {item.models.join(', ')}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {(item.tokens?.input ?? 0) + (item.tokens?.output ?? 0)}{' '}
                    tokens
                  </span>
                  {item.degraded && (
                    <span className="text-[var(--color-accent)]">degraded</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center gap-2">
          {cursors.length > 0 && <Button onClick={goFirst}>First page</Button>}
          {page?.nextCursor && <Button onClick={goNext}>Next</Button>}
        </div>
      </section>
    </RegionErrorBoundary>
  );
}
