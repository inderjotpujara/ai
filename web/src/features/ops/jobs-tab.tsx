import { JobKindWire, JobPriorityWire, JobStatusWire } from '@contracts';
import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { JobDetailDrawer } from './job-detail-drawer.tsx';
import { useJobs } from './use-jobs.ts';

const STATUS_OPTIONS = ['', ...Object.values(JobStatusWire)];
const KIND_OPTIONS = ['', ...Object.values(JobKindWire)];
const PRIORITY_OPTIONS = ['', ...Object.values(JobPriorityWire)];

type Props = {
  /** Row click callback — the drawer wiring lands in Task 29. Defaults to
   *  tracking a local selected-job id so rows still get a visible
   *  "selected" affordance before the drawer exists. */
  onSelect?: (jobId: string) => void;
};

/** Job queue table: status/kind/priority facets (status is server-side,
 *  kind/priority narrow client-side — see `useJobs`), keyset First/Next
 *  paging, and clickable rows. Structured like `RunsArea` but tabular —
 *  same facet/error/empty-state/paging idiom, one row per `JobDTO`. */
export function JobsTab({ onSelect }: Props) {
  const jobs = useJobs();
  const { page, error, query, goNext, goFirst } = jobs;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  // The open drawer's job id — separate from `selectedId` (the row highlight)
  // so `retriedFrom`'s back-link can re-target the drawer to a job whose row
  // isn't even in the current page without disturbing the row selection.
  const [openJobId, setOpenJobId] = useState<string | undefined>(undefined);
  // `useJobs` doesn't expose its internal `cursors[]` — mirror it locally so
  // "First page" only shows once we've actually paged forward, same gate
  // `RunsArea` applies via `cursors.length`.
  const [hasPaged, setHasPaged] = useState(false);
  // Job actions (Task 30) flip a row's displayed status the instant a
  // mutation is fired — before the `useJobs` refresh() round trip lands —
  // keyed by job id. Cleared whenever a fresh `page` object arrives (every
  // `refresh()`/paging/facet change produces one), which is exactly the
  // "reconciled on next refresh()" point the optimistic flip promises.
  const [statusOverlay, setStatusOverlay] = useState<
    Map<string, JobStatusWire>
  >(new Map());

  // biome-ignore lint/correctness/useExhaustiveDependencies: page isn't read in the body — it's a bump-to-clear trigger (a new `page` object is exactly the "reconciled" signal, same idiom as useJobs's reloadTick).
  useEffect(() => {
    setStatusOverlay(new Map());
  }, [page]);

  function applyOptimisticStatus(jobId: string, status: JobStatusWire) {
    setStatusOverlay((prev) => {
      const next = new Map(prev);
      next.set(jobId, status);
      return next;
    });
  }

  function setQuery(patch: Partial<typeof query>) {
    setHasPaged(false);
    jobs.setQuery(patch);
  }

  function next() {
    setHasPaged(true);
    goNext();
  }

  function first() {
    setHasPaged(false);
    goFirst();
  }

  function selectRow(jobId: string) {
    setSelectedId(jobId);
    setOpenJobId(jobId);
    onSelect?.(jobId);
  }

  return (
    <section data-testid="ops-jobs-tab" className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3">
        <select
          data-testid="ops-jobs-status-filter"
          aria-label="Filter by status"
          value={query.status}
          onChange={(e) => setQuery({ status: e.target.value })}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)]"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s || 'All statuses'}
            </option>
          ))}
        </select>

        <select
          data-testid="ops-jobs-kind-filter"
          aria-label="Filter by kind"
          value={query.kind}
          onChange={(e) => setQuery({ kind: e.target.value })}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)]"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k || 'All kinds'}
            </option>
          ))}
        </select>

        <select
          data-testid="ops-jobs-priority-filter"
          aria-label="Filter by priority"
          value={query.priority}
          onChange={(e) => setQuery({ priority: e.target.value })}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm text-[var(--color-fg)]"
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p || 'All priorities'}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-[var(--color-border)] p-4 font-mono text-sm text-[var(--color-muted)]"
        >
          <strong className="text-[var(--color-fg)]">Jobs</strong> failed to
          load. {error}
        </div>
      )}

      {!error && page && page.items.length === 0 && (
        <p className="mt-6 text-sm text-[var(--color-muted)]">No jobs yet</p>
      )}

      {!error && page && page.items.length > 0 && (
        <table
          data-testid="ops-jobs-table"
          className="mt-4 w-full flex-1 overflow-auto font-mono text-sm text-[var(--color-fg)]"
        >
          <thead>
            <tr className="text-left text-[var(--color-muted)]">
              <th className="px-3 py-1.5">ID</th>
              <th className="px-3 py-1.5">Kind</th>
              <th className="px-3 py-1.5">Status</th>
              <th className="px-3 py-1.5">Priority</th>
              <th className="px-3 py-1.5">Attempts</th>
              <th className="px-3 py-1.5">Created</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((job) => (
              <tr
                key={job.id}
                data-testid={`ops-job-row-${job.id}`}
                onClick={() => selectRow(job.id)}
                className={`cursor-pointer rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] ${
                  selectedId === job.id ? 'border-[var(--color-accent)]' : ''
                }`}
              >
                <td className="px-3 py-1.5">{job.id}</td>
                <td className="px-3 py-1.5 text-[var(--color-muted)]">
                  {job.kind}
                </td>
                <td className="px-3 py-1.5 text-[var(--color-muted)]">
                  {statusOverlay.get(job.id) ?? job.status}
                </td>
                <td className="px-3 py-1.5 text-[var(--color-muted)]">
                  {job.priority}
                </td>
                <td className="px-3 py-1.5 text-[var(--color-muted)]">
                  {job.attempts}/{job.maxAttempts}
                </td>
                <td className="px-3 py-1.5 text-[var(--color-muted)]">
                  {new Date(job.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-4 flex items-center gap-2">
        {hasPaged && <Button onClick={first}>First page</Button>}
        {page?.nextCursor && <Button onClick={next}>Next</Button>}
      </div>

      {openJobId && (
        <JobDetailDrawer
          jobId={openJobId}
          onClose={() => setOpenJobId(undefined)}
          onSelect={setOpenJobId}
          refresh={jobs.refresh}
          onOptimisticStatus={applyOptimisticStatus}
        />
      )}
    </section>
  );
}
