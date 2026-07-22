import type { RunListItemDTO } from '@contracts';
import { RunListResponseSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { AddRemoteDialog } from './add-remote-dialog.tsx';
import { CardPreview } from './card-preview.tsx';
import { SkillAllowlistEditor } from './skill-allowlist-editor.tsx';
import { TokenIssue } from './token-issue.tsx';
import { useA2aConfig } from './use-a2a-config.ts';
import { useA2aRemotes } from './use-a2a-remotes.ts';

const CARD_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const CARD_TITLE_CLASS =
  'text-xs uppercase tracking-wide text-[var(--color-muted)]';
const SECTION_TITLE_CLASS = 'font-mono text-sm text-[var(--color-fg)]';

/** Recent runs whose `origin` is `RunOrigin.Remote` — i.e. dispatched from
 *  an inbound A2A `message/send` — fetched from the EXISTING, already
 *  `origin`-filterable `GET /api/runs` endpoint (`RunListQuerySchema.origin`,
 *  `src/server/runs/list.ts`). No new backend/contract surface: this is the
 *  "watch a delegated remote task" capability the brief calls for, wired to
 *  data the Runs list already carries. Best-effort — a failed fetch just
 *  leaves the section empty; the Runs tab (with its own origin filter) is
 *  the load-bearing place to find these. */
function useRecentRemoteRuns() {
  const [runs, setRuns] = useState<RunListItemDTO[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/runs?origin=remote&limit=5', { schema: RunListResponseSchema })
      .then((r) => !cancelled && setRuns(r.items))
      .catch(() => {
        // best-effort nicety — see file-level note above.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return runs;
}

/** Federation tab (Slice 31 Incr 7): the A2A interop console — Expose (T25)
 *  + Consume (this task, T26). Expose is one `useA2aConfig()` instance
 *  driving three panels: the allowlist editor (`skill-allowlist-editor.tsx`,
 *  T25), a live card preview (`card-preview.tsx`), and token issue/revoke
 *  (`token-issue.tsx`) — a skill save / token issue / revoke each
 *  `refresh()`es the shared config, so every panel re-renders from the same
 *  source of truth (the `DevicesTab`/`useDevices` precedent). Consume is one
 *  `useA2aRemotes()` instance: the pinned-remote list + remove, an
 *  `AddRemoteDialog` (test-dry-run → confirm-persist, `addRemote` already
 *  `refresh()`es this same list), and a "recent remote tasks" mini-list
 *  deep-linking into the existing Runs waterfall (`useRecentRemoteRuns`
 *  above) — the Jobs-tab `Link to="/runs/$runId"` precedent
 *  (`job-detail-drawer.tsx`), no new viewer.
 *
 *  SECURITY: none of this component's own JSX touches operator/peer
 *  strings directly — those all render inside child components (Expose's
 *  three + `AddRemoteDialog`'s card preview), each documenting its own
 *  plain-interpolation-only contract. The one exception, `remote.name`/
 *  `.baseUrl`/`.pinnedCardHash` below, is likewise plain React interpolation
 *  only — never `dangerouslySetInnerHTML`. */
export function FederationTab() {
  const { config, error, putSkills, issueToken, revokeToken } = useA2aConfig();
  const {
    remotes,
    error: remotesError,
    addRemote,
    removeRemote,
    testRemote,
  } = useA2aRemotes();
  const recentRemoteRuns = useRecentRemoteRuns();
  const [addRemoteOpen, setAddRemoteOpen] = useState(false);

  return (
    <section data-testid="ops-federation" className="flex flex-col gap-4">
      <h2 className={SECTION_TITLE_CLASS}>Expose</h2>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-muted)]">
          <strong className="text-[var(--color-fg)]">Federation config</strong>{' '}
          failed to load. {error}
        </p>
      )}

      {!error && !config && (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      )}

      {!error && config && (
        <>
          <SkillAllowlistEditor skills={config.skills} onSave={putSkills} />
          <CardPreview cardPreview={config.cardPreview} />
          <TokenIssue
            tokens={config.tokens}
            issueToken={issueToken}
            revokeToken={revokeToken}
          />
        </>
      )}

      <h2 className={SECTION_TITLE_CLASS}>Consume</h2>
      <div data-testid="ops-a2a-remotes" className={CARD_CLASS}>
        <div className="flex items-center justify-between">
          <h3 className={CARD_TITLE_CLASS}>Remote peers</h3>
          <Button
            data-testid="ops-a2a-remote-add-open"
            onClick={() => setAddRemoteOpen(true)}
          >
            Add remote agent
          </Button>
        </div>

        {remotesError && (
          <p role="alert" className="mt-2 text-sm text-[var(--color-muted)]">
            <strong className="text-[var(--color-fg)]">Remote peers</strong>{' '}
            failed to load. {remotesError}
          </p>
        )}
        {!remotesError && remotes && remotes.length === 0 && (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            No remote peers added yet.
          </p>
        )}
        {!remotesError && remotes && remotes.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {remotes.map((r) => (
              <li
                key={r.name}
                data-testid={`ops-a2a-remote-row-${r.name}`}
                className="flex items-center justify-between gap-2 font-mono text-sm text-[var(--color-fg)]"
              >
                <span>
                  {/* SECURITY: plain interpolation only — see file-level note. */}
                  <strong className="font-normal">{r.name}</strong> ·{' '}
                  {r.baseUrl} · pin {r.pinnedCardHash.slice(0, 12)}…
                </span>
                <Button
                  data-testid={`ops-a2a-remote-remove-${r.name}`}
                  onClick={() => void removeRemote(r.name)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <AddRemoteDialog
          open={addRemoteOpen}
          onOpenChange={setAddRemoteOpen}
          testRemote={testRemote}
          addRemote={addRemote}
        />
      </div>

      <div data-testid="ops-a2a-remote-tasks" className={CARD_CLASS}>
        <h3 className={CARD_TITLE_CLASS}>Recent remote tasks</h3>
        {(!recentRemoteRuns || recentRemoteRuns.length === 0) && (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            No remote-delegated tasks yet.
          </p>
        )}
        {recentRemoteRuns && recentRemoteRuns.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {recentRemoteRuns.map((r) => (
              <li key={r.id} data-testid={`ops-a2a-task-row-${r.id}`}>
                <Link
                  to="/runs/$runId"
                  params={{ runId: r.id }}
                  className="font-mono text-sm text-[var(--color-accent)] hover:underline"
                >
                  view run {r.id}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
