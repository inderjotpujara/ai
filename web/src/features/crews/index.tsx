import type { CrewListResponse } from '@contracts';
import { CrewListResponseSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/** Crews browse (D9: a small in-memory registry — no cursor, no server
 *  facets; search is client-side over name/description). Rows link into
 *  `/crews/$crewName` (Task 15). */
export function CrewsArea() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<CrewListResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch('/crews', { schema: CrewListResponseSchema })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(err instanceof Error ? err.message : 'failed to load crews');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = search.trim().toLowerCase();
  const items = (page?.items ?? []).filter(
    (item) =>
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q),
  );

  return (
    <RegionErrorBoundary region="Crews">
      <section data-testid="area-crews" className="flex h-full flex-col p-8">
        <h1 className="font-mono text-lg text-[var(--color-fg)]">Crews</h1>

        <input
          data-testid="crews-search"
          type="search"
          placeholder="Search crews…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
        />

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Crews</strong> failed to
            load. {error}
          </div>
        )}

        {!error && page && items.length === 0 && (
          <p className="mt-6 text-sm text-[var(--color-muted)]">
            No crews found
          </p>
        )}

        {!error && page && items.length > 0 && (
          <ul className="mt-4 flex flex-1 flex-col gap-2 overflow-auto">
            {items.map((item) => (
              <li key={item.name}>
                <Link
                  to="/crews/$crewName"
                  params={{ crewName: item.name }}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-fg)] hover:border-[var(--color-accent)]"
                >
                  <span className="text-[var(--color-fg)]">{item.name}</span>
                  <span className="text-[var(--color-muted)]">
                    {item.process}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {item.memberCount} members
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {item.taskCount} tasks
                  </span>
                  {item.description && (
                    <span className="text-[var(--color-muted)]">
                      {item.description}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
