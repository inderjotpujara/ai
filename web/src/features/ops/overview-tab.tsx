import type { JobDTO } from '@contracts';
import { JobStatusWire } from '@contracts';
import { Fragment } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { RegionErrorBoundary } from '../../shared/ui/error-boundary.tsx';
import { useDaemonStatus } from './use-daemon-status.ts';
import { useJobActions } from './use-job-actions.ts';
import { useJobs } from './use-jobs.ts';
import { useQueueStats } from './use-queue-stats.ts';

/** Every wire status, in a fixed display order — iterated (not derived from
 *  `stats.counts`'s own keys) so an ABSENT status still gets a `0` row; see
 *  the `counts[status] ?? 0` read below. */
const ALL_STATUSES = Object.values(JobStatusWire);

const CARD_CLASS =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const CARD_TITLE_CLASS =
  'text-xs uppercase tracking-wide text-[var(--color-muted)]';
const DL_CLASS =
  'mt-2 grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 font-mono text-sm text-[var(--color-fg)]';

function formatUptime(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

/** Statuses `useJobActions().resume` accepts a one-click affordance for on
 *  this card — mirrors `JobDetailDrawer`'s interrupted-gets-Resume /
 *  everything-else-gets-Retry split, scoped here to the two statuses that
 *  land in "Recent failures" (`failed`/`interrupted`). */
function actionLabel(status: JobDTO['status']): 'Resume' | 'Retry' {
  return status === JobStatusWire.Interrupted ? 'Resume' : 'Retry';
}

/** Overview tab (Task 33): three health cards — Daemon, Queue, Recent
 *  failures — consuming the Task-32 polling hooks (`useDaemonStatus`,
 *  `useQueueStats`) plus `useJobs`/`useJobActions` (T27/T30). Card-lite by
 *  design (no visx charts — deferred); the daemon-logs viewer itself is
 *  T34, this only reserves its mount point.
 *
 *  `QueueStatsDTO.counts` is a PARTIAL map (`z.partialRecord` — see
 *  `use-queue-stats.ts`): a status with zero jobs is simply absent, not
 *  present-with-0. Every `JobStatusWire` value is iterated from
 *  `ALL_STATUSES` (not from `Object.keys(stats.counts)`) and read via
 *  `counts[status] ?? 0`, so an absent status always renders `0`, never a
 *  blank cell or `undefined`. `activeCount` (in-flight worker-pool
 *  controllers) and `counts[running]` (durable row status) are rendered
 *  under distinct labels — "active workers" vs "running rows" — and are
 *  NEVER summed or reconciled against each other: they can legitimately
 *  diverge transiently (§7.2), and presenting one as derived from the other
 *  would hide that. */
export function OverviewTab() {
  const { status, error: daemonError } = useDaemonStatus();
  const { stats, error: queueError } = useQueueStats();
  const jobs = useJobs();
  const actions = useJobActions(jobs.refresh);

  const recentFailures = (jobs.page?.items ?? [])
    .filter(
      (j) =>
        j.status === JobStatusWire.Failed ||
        j.status === JobStatusWire.Interrupted,
    )
    .slice(0, 5);

  async function runAction(job: JobDTO): Promise<void> {
    if (job.status === JobStatusWire.Interrupted) await actions.resume(job);
    else await actions.retry(job);
  }

  return (
    <section data-testid="ops-overview" className="grid gap-4 md:grid-cols-3">
      <RegionErrorBoundary region="Ops: Daemon">
        <div data-testid="ops-overview-daemon" className={CARD_CLASS}>
          <h2 className={CARD_TITLE_CLASS}>Daemon</h2>
          {daemonError && (
            <p role="alert" className="mt-2 text-sm text-[var(--color-muted)]">
              <strong className="text-[var(--color-fg)]">Daemon</strong> status
              failed to load. {daemonError}
            </p>
          )}
          {!daemonError && !status && (
            <p className="mt-2 text-sm text-[var(--color-muted)]">Loading…</p>
          )}
          {!daemonError && status && (
            <dl className={DL_CLASS}>
              <dt className="text-[var(--color-muted)]">State</dt>
              <dd data-testid="ops-daemon-state">
                {status.running ? 'running' : 'stopped'}
              </dd>
              <dt className="text-[var(--color-muted)]">pid</dt>
              <dd>{status.pid ?? '—'}</dd>
              <dt className="text-[var(--color-muted)]">Uptime</dt>
              <dd>{formatUptime(status.uptimeMs)}</dd>
            </dl>
          )}
          {/* Daemon-logs viewer mount point — filled in Task 34. */}
          <div data-testid="ops-daemon-logs-mount" className="mt-3" />
        </div>
      </RegionErrorBoundary>

      <RegionErrorBoundary region="Ops: Queue">
        <div data-testid="ops-overview-queue" className={CARD_CLASS}>
          <h2 className={CARD_TITLE_CLASS}>Queue</h2>
          {queueError && (
            <p role="alert" className="mt-2 text-sm text-[var(--color-muted)]">
              <strong className="text-[var(--color-fg)]">Queue</strong> stats
              failed to load. {queueError}
            </p>
          )}
          {!queueError && !stats && (
            <p className="mt-2 text-sm text-[var(--color-muted)]">Loading…</p>
          )}
          {!queueError && stats && (
            <>
              <dl className={DL_CLASS}>
                {ALL_STATUSES.map((s) => (
                  <Fragment key={s}>
                    <dt className="text-[var(--color-muted)]">{s}</dt>
                    <dd data-testid={`ops-queue-count-${s}`}>
                      {stats.counts[s] ?? 0}
                    </dd>
                  </Fragment>
                ))}
              </dl>
              <dl className={`${DL_CLASS} mt-3`}>
                <dt className="text-[var(--color-muted)]">active workers</dt>
                <dd data-testid="ops-queue-active">{stats.activeCount}</dd>
                <dt className="text-[var(--color-muted)]">running rows</dt>
                <dd data-testid="ops-queue-running-rows">
                  {stats.counts[JobStatusWire.Running] ?? 0}
                </dd>
                <dt className="text-[var(--color-muted)]">concurrency</dt>
                <dd>{stats.concurrency}</dd>
              </dl>
            </>
          )}
        </div>
      </RegionErrorBoundary>

      <RegionErrorBoundary region="Ops: Recent failures">
        <div data-testid="ops-overview-failures" className={CARD_CLASS}>
          <h2 className={CARD_TITLE_CLASS}>Recent failures</h2>
          {jobs.error && (
            <p role="alert" className="mt-2 text-sm text-[var(--color-muted)]">
              <strong className="text-[var(--color-fg)]">Jobs</strong> failed to
              load. {jobs.error}
            </p>
          )}
          {!jobs.error && recentFailures.length === 0 && (
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              No recent failures
            </p>
          )}
          {!jobs.error && recentFailures.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {recentFailures.map((job) => (
                <li
                  key={job.id}
                  data-testid={`ops-failure-${job.id}`}
                  className="flex items-center justify-between gap-2 font-mono text-sm text-[var(--color-fg)]"
                >
                  <span>
                    {job.id} · {job.status}
                  </span>
                  <Button
                    data-testid={`ops-failure-action-${job.id}`}
                    onClick={() => void runAction(job)}
                  >
                    {actionLabel(job.status)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </RegionErrorBoundary>
    </section>
  );
}
