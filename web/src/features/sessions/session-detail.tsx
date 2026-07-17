import type { SessionDTO } from '@contracts';
import { SessionDtoSchema } from '@contracts';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  ApiError,
  apiFetch,
  sessionToken,
} from '../../shared/contract/client.ts';
import { downloadBlob } from '../../shared/download.ts';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';

/**
 * Route entry: mounts a fresh view per session via `key`, mirroring
 * `RunDetail`/`CrewDetail`'s remount-on-nav pattern — without it, session
 * A's loaded transcript would linger while session B's params race in.
 */
export function SessionDetail() {
  const { sessionId } = useParams({ from: '/sessions/$sessionId' });
  return <SessionDetailView key={sessionId} sessionId={sessionId} />;
}

function SessionDetailView({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // Mirrors MemoryTab's `refreshSpaces` idiom (`library/memory-tab.tsx:50-58`):
  // a plain function, called directly by the mount effect AND after a
  // mutation, rather than a memoized callback with a dependency array to
  // fight. No cancelled-flag guard is needed — this component fully remounts
  // per sessionId via the `key` above (same reasoning as CrewDetailView).
  function loadSession() {
    apiFetch(`/sessions/${sessionId}`, { schema: SessionDtoSchema })
      .then((result) => {
        setSession(result);
        setTitleDraft(result.title);
        setError(undefined);
      })
      .catch((err: unknown) => {
        setSession(undefined);
        setError(err instanceof Error ? err.message : 'failed to load session');
      });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadSession is a fresh closure per render; only sessionId should retrigger the initial load (this component fully remounts per session via key={sessionId} at the route level)
  useEffect(() => {
    setSession(undefined);
    loadSession();
  }, [sessionId]);

  // Rename/delete deliberately use raw `fetch` (not `apiFetch`) and never
  // parse the response body — correct regardless of whether the server
  // returns the full updated SessionDTO, a bare {ok}, or an empty 204 (see
  // the plan's "Assumptions carried from Increments 1-3" note #6).
  async function handleRename() {
    if (!titleDraft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${sessionToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: titleDraft.trim() }),
      });
      if (!res.ok) throw new ApiError('rename failed', res.status);
      loadSession();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'rename failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this session? This cannot be undone.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sessionToken()}` },
      });
      if (!res.ok) throw new ApiError('delete failed', res.status);
      navigate({ to: '/sessions' });
    } catch (err: unknown) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'delete failed');
    }
  }

  async function handleExport() {
    setError(undefined);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export`, {
        headers: { Authorization: `Bearer ${sessionToken()}` },
      });
      if (!res.ok) throw new ApiError('export failed', res.status);
      const text = await res.text();
      downloadBlob(
        `session-${sessionId}.md`,
        text,
        'text/markdown;charset=utf-8',
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'export failed');
    }
  }

  return (
    <RegionErrorBoundary region="Session">
      <section
        data-testid="session-detail"
        className="flex h-full flex-col p-8"
      >
        <h1 className="font-mono text-lg text-[var(--color-fg)]">
          Session {session?.title || sessionId}
        </h1>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Session</strong> failed.{' '}
            {error}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            data-testid="session-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)]"
          />
          <Button
            data-testid="session-rename-button"
            disabled={busy}
            onClick={handleRename}
          >
            Rename
          </Button>
          <Button
            data-testid="session-export-button"
            disabled={busy}
            onClick={handleExport}
          >
            Export
          </Button>
          <Button
            data-testid="session-delete-button"
            variant="accent"
            disabled={busy}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>

        {session && (
          <ul
            data-testid="session-messages"
            className="mt-4 flex flex-1 flex-col gap-3 overflow-auto"
          >
            {session.messages.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-fg)]"
              >
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  {m.role}
                  {m.degraded && ' · degraded'}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{m.text}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
