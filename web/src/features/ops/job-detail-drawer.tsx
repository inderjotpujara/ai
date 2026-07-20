import type { JobDTO } from '@contracts';
import { JobDtoSchema, JobStatusWire } from '@contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/contract/client.ts';
import { Button } from '../../shared/ui/button.tsx';
import { useToast } from '../notifications/toast.tsx';
import { useJobActions } from './use-job-actions.ts';

type Props = {
  jobId: string;
  onClose: () => void;
  /** Re-opens the drawer on a different job id — used by the `retriedFrom`
   *  back-link to jump to the job this one was retried from. */
  onSelect: (jobId: string) => void;
  /** `useJobs`'s reload trigger (Task 30) — each action calls this via
   *  `useJobActions` to reconcile the optimistic status flip below with the
   *  server's real post-mutation state. */
  refresh: () => void;
  /** Lets the jobs-tab table's row overlay mirror this drawer's optimistic
   *  status flip immediately, without waiting for `refresh()`'s round trip
   *  (Task 30). */
  onOptimisticStatus: (jobId: string, status: JobStatusWire) => void;
};

function formatTs(ms: number | undefined): string {
  return ms === undefined ? '—' : new Date(ms).toLocaleString();
}

/** Statuses `POST /api/jobs/:id/retry` accepts (`RETRYABLE`,
 *  `src/server/jobs/retry.ts`) — mirrored here so the Retry button's gating
 *  matches the server's 404-on-out-of-state-retry exactly. */
const RETRYABLE_STATUSES = new Set<JobStatusWire>([
  JobStatusWire.Failed,
  JobStatusWire.Canceled,
  JobStatusWire.Interrupted,
]);

type ActionKind = 'cancel' | 'resume' | 'retry';

/** Job detail drawer (Task 29): fetches the full `JobDTO` via
 *  `GET /api/jobs/:id` (the jobs-tab row only carries the list-summary
 *  shape) and renders every field the brief calls out — payload, attempt
 *  counters, all four lifecycle timestamps, the retry-scheduled-at
 *  (`availableAt`), `error`, `origin`/priority/status, a deep-link into the
 *  Runs viewer for `runId`, and a `retriedFrom` back-link that re-opens the
 *  drawer on the parent job. Action buttons (cancel/resume/retry) are wired
 *  in Task 30 via `useJobActions`, each optimistically flipping
 *  `detail.status` (and the table row via `onOptimisticStatus`) before the
 *  request settles, reverting on error and reconciling for real on the
 *  `refresh()` that follows a success. */
export function JobDetailDrawer({
  jobId,
  onClose,
  onSelect,
  refresh,
  onOptimisticStatus,
}: Props) {
  const [detail, setDetail] = useState<JobDTO | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<ActionKind | undefined>(undefined);
  const actions = useJobActions(refresh);
  const { notify } = useToast();

  // Also called (standalone, not as a dependency of the effect below) from
  // `runAction` after a mutation settles, to reconcile this drawer's own
  // `detail` with the real post-mutation status.
  function loadDetail(): Promise<JobDTO> {
    return apiFetch<JobDTO>(`/jobs/${jobId}`, { schema: JobDtoSchema });
  }

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setError(undefined);
    setPending(undefined);
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

  /** Runs one lifecycle action: disables all three action buttons and marks
   *  which one is `pending` (its label swaps to "…ing"), optimistically
   *  flips the TABLE row's status via `onOptimisticStatus` (Task 30), then
   *  calls the matching `useJobActions` mutation (which triggers the
   *  jobs-tab's `refresh()` on success). This drawer's OWN `detail.status`
   *  is deliberately NOT optimistically mutated — the action buttons are
   *  gated on it (`RETRYABLE_STATUSES`/queued-running/interrupted checks
   *  above), so flipping it immediately would make the button vanish mid-
   *  request instead of visibly disabling; the real status only replaces it
   *  once `loadDetail()` re-fetches after the mutation settles, which is
   *  also when button gating legitimately changes. `resume` re-enqueues the
   *  SAME `runId` (never mints a fresh one — ADVERSARIAL-VERIFY), so the
   *  existing "view run {runId}" `Link` above stays the correct deep-link
   *  the operator can follow to watch the continued run; no separate
   *  post-resume navigation is needed since the target doesn't change. On
   *  error, the table row's optimistic flip is reverted and the failure
   *  surfaces as a toast — the row is never left in a false state. */
  async function runAction(kind: ActionKind, optimisticStatus: JobStatusWire) {
    if (!detail || pending) return;
    const job = detail;
    setPending(kind);
    onOptimisticStatus(jobId, optimisticStatus);
    try {
      if (kind === 'cancel') await actions.cancel(job);
      else if (kind === 'resume') await actions.resume(job);
      else await actions.retry(job);
      const fresh = await loadDetail();
      setDetail(fresh);
      onOptimisticStatus(jobId, fresh.status);
    } catch (err: unknown) {
      onOptimisticStatus(jobId, job.status);
      notify(err instanceof Error ? err.message : `${kind} failed`);
    } finally {
      setPending(undefined);
    }
  }

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

          <div data-testid="ops-job-drawer-actions" className="mt-2 flex gap-2">
            {(detail.status === JobStatusWire.Queued ||
              detail.status === JobStatusWire.Running) && (
              <Button
                data-testid="ops-job-action-cancel"
                disabled={pending !== undefined}
                onClick={() => runAction('cancel', JobStatusWire.Canceled)}
              >
                {pending === 'cancel' ? 'Canceling…' : 'Cancel'}
              </Button>
            )}
            {detail.status === JobStatusWire.Interrupted && detail.runId && (
              <Button
                data-testid="ops-job-action-resume"
                disabled={pending !== undefined}
                onClick={() => runAction('resume', JobStatusWire.Running)}
              >
                {pending === 'resume' ? 'Resuming…' : 'Resume'}
              </Button>
            )}
            {RETRYABLE_STATUSES.has(detail.status) && (
              <Button
                data-testid="ops-job-action-retry"
                disabled={pending !== undefined}
                onClick={() => runAction('retry', JobStatusWire.Queued)}
              >
                {pending === 'retry' ? 'Retrying…' : 'Retry'}
              </Button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
