import type { CrewDetailDTO } from '@contracts';
import {
  CrewDetailDtoSchema,
  CrewProcess,
  RunLaunchResponseSchema,
} from '@contracts';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { DagView } from '../../shared/dag/dag-view.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { crewGraph } from './crew-graph.ts';

/** Route entry: mounts a fresh view per crew via `key`, mirroring RunDetail's
 *  remount-on-nav pattern (Phase 3). */
export function CrewDetail() {
  const { crewName } = useParams({ from: '/crews/$crewName' });
  return <CrewDetailView key={crewName} crewName={crewName} />;
}

function CrewDetailView({ crewName }: { crewName: string }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CrewDetailDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setError(undefined);
    apiFetch(`/crews/${crewName}`, { schema: CrewDetailDtoSchema })
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed to load crew');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [crewName]);

  async function handleRun() {
    setLaunching(true);
    try {
      const { runId } = await apiFetch(`/crews/${crewName}/run`, {
        method: 'POST',
        body: { input },
        schema: RunLaunchResponseSchema,
      });
      // Amendment A: carry the def id so /runs/$runId can drive the live
      // overlay off the same process-aware crewGraph instead of re-deriving
      // it from run data alone (Task 18 consumes graphKind/graphId).
      navigate({
        to: '/runs/$runId',
        params: { runId },
        search: { graphKind: 'crew', graphId: crewName },
      });
    } catch (err: unknown) {
      setLaunching(false);
      setError(err instanceof Error ? err.message : 'failed to launch run');
    }
  }

  return (
    <RegionErrorBoundary region="Crew">
      <section data-testid="crew-detail" className="flex h-full flex-col p-8">
        <h1 className="font-mono text-lg text-[var(--color-fg)]">
          Crew {crewName}
        </h1>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
          >
            <strong className="text-[var(--color-fg)]">Crew</strong> failed.{' '}
            {error}
          </div>
        )}

        {detail && (
          <>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {detail.process} · {detail.members.length} members ·{' '}
              {detail.tasks.length} tasks
            </p>

            <ul
              data-testid="crew-members"
              className="mt-4 flex flex-wrap gap-2"
            >
              {detail.members.map((m) => (
                <li
                  key={m.name}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs text-[var(--color-fg)]"
                >
                  {m.name} — {m.role}
                </li>
              ))}
            </ul>

            {detail.process === CrewProcess.Hierarchical && (
              <ul
                data-testid="crew-tasks"
                className="mt-2 flex flex-wrap gap-2"
              >
                {detail.tasks.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-xs text-[var(--color-muted)]"
                  >
                    {t.id}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex-1">
              <DagView model={crewGraph(detail)} />
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                data-testid="crew-run-input"
                type="text"
                placeholder="Input…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-fg)]"
              />
              <Button
                data-testid="crew-run-button"
                variant="accent"
                disabled={launching || !input.trim()}
                onClick={handleRun}
              >
                {launching ? 'Launching…' : 'Run'}
              </Button>
            </div>
          </>
        )}
      </section>
    </RegionErrorBoundary>
  );
}
