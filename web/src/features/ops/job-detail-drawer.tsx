import type { JobDTO } from '@contracts';
import { JobDtoSchema } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';

type Props = {
  jobId: string;
  onClose: () => void;
  /** Re-opens the drawer on a different job id — used by the `retriedFrom`
   *  back-link to jump to the job this one was retried from. */
  onSelect: (jobId: string) => void;
};

function formatTs(ms: number | undefined): string {
  return ms === undefined ? '—' : new Date(ms).toLocaleString();
}

/** Job detail drawer (Task 29): fetches the full `JobDTO` via
 *  `GET /api/jobs/:id` (the jobs-tab row only carries the list-summary
 *  shape) and renders every field the brief calls out — payload, attempt
 *  counters, all four lifecycle timestamps, the retry-scheduled-at
 *  (`availableAt`), `error`, `origin`/priority/status, a deep-link into the
 *  Runs viewer for `runId`, and a `retriedFrom` back-link that re-opens the
 *  drawer on the parent job. Action buttons (cancel/resume/retry) are a
 *  placeholder region here — wired in Task 30, not this one. */
export function JobDetailDrawer({ jobId, onClose, onSelect }: Props) {
  const [detail, setDetail] = useState<JobDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setError(undefined);
    apiFetch<JobDTO>(`/jobs/${jobId}`, { schema: JobDtoSchema })
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'failed to load job');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <aside
      data-testid="ops-job-drawer"
      className="fixed inset-y-0 right-0 w-[28rem] max-w-[90vw] overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4 font-mono text-sm text-[var(--color-fg)] shadow-2xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
          Job {jobId}
        </h2>
        <Button data-testid="ops-job-drawer-close" onClick={onClose}>
          Close
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-[var(--color-border)] p-4 text-[var(--color-muted)]"
        >
          <strong className="text-[var(--color-fg)]">Job</strong> failed to
          load. {error}
        </div>
      )}

      {!error && !detail && (
        <p className="mt-4 text-[var(--color-muted)]">Loading…</p>
      )}

      {detail && (
        <div className="mt-4 flex flex-col gap-3">
          {detail.retriedFrom && (
            <button
              type="button"
              onClick={() => onSelect(detail.retriedFrom as string)}
              className="w-fit rounded-md border border-[var(--color-border)] px-2 py-1 text-left text-[var(--color-accent)] hover:border-[var(--color-accent)]"
            >
              retry of {detail.retriedFrom}
            </button>
          )}

          <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1">
            <dt className="text-[var(--color-muted)]">Kind</dt>
            <dd>{detail.kind}</dd>
            <dt className="text-[var(--color-muted)]">Status</dt>
            <dd>{detail.status}</dd>
            <dt className="text-[var(--color-muted)]">Priority</dt>
            <dd>{detail.priority}</dd>
            <dt className="text-[var(--color-muted)]">Attempts</dt>
            <dd>
              {detail.attempts}/{detail.maxAttempts}
            </dd>
            <dt className="text-[var(--color-muted)]">Created</dt>
            <dd>{formatTs(detail.createdAt)}</dd>
            <dt className="text-[var(--color-muted)]">Updated</dt>
            <dd>{formatTs(detail.updatedAt)}</dd>
            <dt className="text-[var(--color-muted)]">Started</dt>
            <dd>{formatTs(detail.startedAt)}</dd>
            <dt className="text-[var(--color-muted)]">Finished</dt>
            <dd>{formatTs(detail.finishedAt)}</dd>
            <dt className="text-[var(--color-muted)]">Retry scheduled</dt>
            <dd>{formatTs(detail.availableAt)}</dd>
          </dl>

          {detail.runId && (
            <Link
              to="/runs/$runId"
              params={{ runId: detail.runId }}
              className="w-fit rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-accent)] hover:border-[var(--color-accent)]"
            >
              view run {detail.runId}
            </Link>
          )}

          <div>
            <h3 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Payload
            </h3>
            <pre className="mt-1 overflow-x-auto rounded-md border border-[var(--color-border)] p-2">
              {JSON.stringify(detail.payload, null, 2)}
            </pre>
          </div>

          {detail.error && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Error
              </h3>
              <p className="mt-1 whitespace-pre-wrap text-[var(--color-fg)]">
                {detail.error}
              </p>
            </div>
          )}

          {/* Cancel/resume/retry actions land in Task 30 — this region is
           *  reserved so the drawer's layout doesn't shift when they're added. */}
          <div
            data-testid="ops-job-drawer-actions"
            className="mt-2 flex gap-2"
          />
        </div>
      )}
    </aside>
  );
}
