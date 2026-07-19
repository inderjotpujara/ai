import type { SessionListResponse } from '@contracts';
import { SessionListResponseSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';

const SIDEBAR_LIMIT = 10;
/**
 * There is no shared event bus between `ChatArea`'s session-minting (Part A,
 * Increment 2) and this sidebar, so "refresh after session-create" is
 * approximated with a light interval poll rather than a direct callback — a
 * documented, deliberate simplification (see the plan's "Assumptions carried
 * from Increments 1-3" note #7).
 */
const SIDEBAR_POLL_MS = 10_000;

/** The AppShell's left rail: the 10 most-recently-active sessions, linking
 *  into `/sessions/$sessionId`. Replaces the Phase-1 placeholder stub. */
export function SessionsSidebar() {
  const [items, setItems] = useState<SessionListResponse['items']>([]);

  function refresh() {
    apiFetch(`/sessions?limit=${SIDEBAR_LIMIT}`, {
      schema: SessionListResponseSchema,
    })
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is a fresh closure per render; this effect intentionally runs once on mount (poll-forever via setInterval), not on every re-render.
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, SIDEBAR_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <aside
      data-testid="sessions-sidebar"
      aria-label="Recent sessions"
      className="w-[var(--spacing-rail)] shrink-0 border-r border-[var(--color-border)] p-4"
    >
      <h2 className="font-mono text-xs uppercase tracking-wide text-[var(--color-muted)]">
        Sessions
      </h2>
      {items.length === 0 && (
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          No sessions yet
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((s) => (
          <li key={s.id}>
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: s.id }}
              className="block truncate rounded px-2 py-1 font-mono text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
            >
              {s.title || s.id}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to="/sessions"
        className="mt-3 block font-mono text-xs text-[var(--color-accent)]"
      >
        See all →
      </Link>
    </aside>
  );
}
