import { Link } from '@tanstack/react-router';
import { Button } from '../../shared/ui/button.tsx';
import { useTriggerFirings } from './use-trigger-firings.ts';

type Props = {
  triggerId: string;
  /** The trigger's display name for the drawer header — user-authored, so
   *  it MUST render via plain React interpolation only (never
   *  `dangerouslySetInnerHTML`), the `triggers-tab.tsx` XSS-safe-name
   *  precedent. Optional: a fire from a row not currently in the list (or a
   *  since-deleted trigger) still opens the drawer, just without a name. */
  triggerName?: string;
  onClose: () => void;
};

function formatTs(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Trigger firing-history drawer (Slice 25, Task 30) — the LAST console
 *  task. Opened by clicking a trigger row (wired in `triggers-tab.tsx`),
 *  mirrors the `JobDetailDrawer` shell (fixed right-hand aside, Close
 *  button, `data-testid` idiom) but lists `useTriggerFirings`'s keyset page
 *  of firing records instead of a single job's fields.
 *
 *  Each row shows `firedAt`/`outcome` plus a `/runs/$runId` deep-link (the
 *  `JobDetailDrawer`'s `runId` `Link` precedent) and the `jobId` when the
 *  firing enqueued one — both are absent for a `skipped-overlap`/
 *  pre-enqueue-`failed` outcome (`TriggerFiringDtoSchema`'s contract), so
 *  the link only renders when `runId` is present. Paging reuses
 *  `useTriggerFirings`'s `goNext`/`goFirst`, the `JobsTab` First/Next idiom. */
export function TriggerFiringsDrawer({
  triggerId,
  triggerName,
  onClose,
}: Props) {
  const { page, error, goNext, goFirst } = useTriggerFirings(triggerId);

  return (
    <aside
      data-testid="ops-trigger-firings-drawer"
      className="fixed inset-y-0 right-0 w-[28rem] max-w-[90vw] overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4 font-mono text-sm text-[var(--color-fg)] shadow-2xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
          {/* SECURITY: plain interpolation only — see file-level note. */}
          Firings: {triggerName ?? triggerId}
        </h2>
        <Button
          data-testid="ops-trigger-firings-drawer-close"
          onClick={onClose}
        >
          Close
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-[var(--color-border)] p-4 text-[var(--color-muted)]"
        >
          <strong className="text-[var(--color-fg)]">Firings</strong> failed to
          load. {error}
        </p>
      )}

      {!error && !page && (
        <p className="mt-4 text-[var(--color-muted)]">Loading…</p>
      )}

      {!error && page && page.items.length === 0 && (
        <p className="mt-4 text-[var(--color-muted)]">No firings yet.</p>
      )}

      {!error && page && page.items.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {page.items.map((firing) => (
            <li
              key={firing.id}
              data-testid={`ops-firing-${firing.id}`}
              className="rounded-md border border-[var(--color-border)] p-2"
            >
              <div className="flex items-center justify-between">
                <span>{formatTs(firing.firedAt)}</span>
                <span className="text-[var(--color-muted)]">
                  {firing.outcome}
                </span>
              </div>
              {firing.runId && (
                <Link
                  to="/runs/$runId"
                  params={{ runId: firing.runId }}
                  className="mt-1 inline-block w-fit rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-accent)] hover:border-[var(--color-accent)]"
                >
                  view run {firing.runId}
                </Link>
              )}
              {firing.jobId && !firing.runId && (
                <p className="mt-1 text-[var(--color-muted)]">
                  job {firing.jobId}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button data-testid="ops-firings-first" onClick={goFirst}>
          First page
        </Button>
        {page?.nextCursor && (
          <Button data-testid="ops-firings-next" onClick={goNext}>
            Next
          </Button>
        )}
      </div>
    </aside>
  );
}
