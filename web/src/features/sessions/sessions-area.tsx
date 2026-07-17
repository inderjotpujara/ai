import type { SessionListResponse } from '@contracts';
import { SessionListResponseSchema } from '@contracts';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

type Query = { search: string };
const emptyQuery: Query = { search: '' };

function toQueryString(query: Query, cursor: string | undefined): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `/sessions?${qs}` : '/sessions';
}

/**
 * Sessions history: search + cursor-paginated rows — mirrors `RunsArea`
 * (`features/runs/index.tsx`) exactly, minus the outcome/degraded/kind
 * facets that don't apply to sessions (spec D10: the identical opaque-cursor
 * `{items, nextCursor?, total}` contract, SQL-backed server-side instead of
 * an in-process array). Rows aren't links yet — `/sessions/$sessionId` is
 * registered by T54, which will make each row navigable.
 */
export function SessionsArea() {
  const [query, setQuery] = useState<Query>(emptyQuery);
  const [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<SessionListResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const cursor = cursors.at(-1);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch(toQueryString(query, cursor), {
      schema: SessionListResponseSchema,
    })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(
            err instanceof Error ? err.message : 'failed to load sessions',
          );
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
    <RegionErrorBoundary region="Sessions">
      <section data-testid="area-sessions" className="flex h-full flex-col p-8">
        <h1 className="font-mono text-lg text-[var(--color-fg)]">Sessions</h1>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            data-testid="sessions-search"
            type="search"
            placeholder="Search sessions…"
            value={query.search}
            onChange={(e) => updateQuery({ search: e.target.value })}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Sessions</strong> failed
            to load. {error}
          </div>
        )}

        {!error && page && page.items.length === 0 && (
          <p className="mt-6 text-sm text-[var(--color-muted)]">
            No sessions yet
          </p>
        )}

        {!error && page && page.items.length > 0 && (
          <ul className="mt-4 flex flex-1 flex-col gap-2 overflow-auto">
            {page.items.map((item) => (
              <li key={item.id}>
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-fg)]">
                  <span className="text-[var(--color-fg)]">
                    {item.title || item.id}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {new Date(
                      item.lastMessageAt ?? item.updatedAt,
                    ).toLocaleString()}
                  </span>
                </div>
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
