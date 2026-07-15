import type { WorkflowListResponse } from '@contracts';
import { WorkflowListResponseSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/** Workflows browse — mirrors CrewsArea (D9: small registry, no cursor,
 *  client-side search). Rows link into `/workflows/$workflowId` (Task 17). */
export function WorkflowsArea() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<WorkflowListResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    apiFetch('/workflows', { schema: WorkflowListResponseSchema })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPage(undefined);
          setError(
            err instanceof Error ? err.message : 'failed to load workflows',
          );
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
      item.id.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q),
  );

  return (
    <RegionErrorBoundary region="Workflows">
      <section
        data-testid="area-workflows"
        className="flex h-full flex-col p-8"
      >
        <h1 className="font-mono text-lg text-[var(--color-fg)]">Workflows</h1>

        <input
          data-testid="workflows-search"
          type="search"
          placeholder="Search workflows…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
        />

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Workflows</strong> failed
            to load. {error}
          </div>
        )}

        {!error && page && items.length === 0 && (
          <p className="mt-6 text-sm text-[var(--color-muted)]">
            No workflows found
          </p>
        )}

        {!error && page && items.length > 0 && (
          <ul className="mt-4 flex flex-1 flex-col gap-2 overflow-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to="/workflows/$workflowId"
                  params={{ workflowId: item.id }}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-fg)] hover:border-[var(--color-accent)]"
                >
                  <span className="text-[var(--color-fg)]">{item.id}</span>
                  <span className="text-[var(--color-muted)]">
                    {item.stepCount} steps
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
