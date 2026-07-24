import type { EvalHealthDTO } from '@contracts';
import { useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { useEvalHistory, useEvals, useReeval } from './use-evals.ts';

/** Filled = passed, hollow = failed — a shape distinction, never color-only. */
function verdictGlyph(passed: boolean): string {
  return passed ? '●' : '○';
}

/** One artifact's history trend (Task 21): a compact newest-first verdict
 *  strip. Mounted only while its row is expanded (the `JobDetailDrawer`
 *  conditional-mount idiom — `evals-tab.tsx` reuses it), so collapsing a row
 *  also cancels its `eval_history` fetch. */
function EvalTrend({ artifact }: { artifact: string }) {
  const { page, error } = useEvalHistory(artifact);

  if (error) {
    return (
      <p role="alert" className="text-xs text-[var(--color-muted)]">
        Trend failed to load. {error}
      </p>
    );
  }
  if (!page) {
    return <p className="text-xs text-[var(--color-muted)]">Loading trend…</p>;
  }
  if (page.items.length === 0) {
    return (
      <p className="text-xs text-[var(--color-muted)]">No re-evals yet.</p>
    );
  }
  return (
    <ul
      data-testid={`ops-eval-trend-${artifact}`}
      className="flex flex-wrap gap-1 font-mono text-sm"
    >
      {page.items.map((row) => (
        <li
          key={row.id}
          data-testid={`ops-eval-trend-point-${row.id}`}
          data-regressed={row.regressed || undefined}
          title={`${row.model} · ${new Date(row.ts).toLocaleString()}`}
          className={
            row.regressed
              ? 'text-[var(--color-fg)]'
              : 'text-[var(--color-muted)]'
          }
        >
          {verdictGlyph(row.passed)}
        </li>
      ))}
    </ul>
  );
}

type RowProps = {
  item: EvalHealthDTO;
  expanded: boolean;
  onToggle: () => void;
  onReeval: (ref: string) => Promise<void>;
  pending: boolean;
};

/** One artifact×model health row: baseline `verifiedWith` vs the latest
 *  re-eval verdict, the 👎 count, a per-case grid (a failing case gets
 *  `data-regressed`), a "re-eval now" action, and an on-demand trend. */
function EvalRow({ item, expanded, onToggle, onReeval, pending }: RowProps) {
  return (
    <li
      data-testid={`ops-eval-row-${item.artifact}`}
      data-regressed={item.regressed || undefined}
      className={`flex flex-col gap-2 rounded-md border p-3 ${
        item.regressed
          ? 'border-[var(--color-accent)]'
          : 'border-[var(--color-border)]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <strong className="font-mono text-sm text-[var(--color-fg)]">
            {item.artifact}
          </strong>
          <span className="text-xs text-[var(--color-muted)]">
            baseline {item.baselineModel ?? '—'} · current{' '}
            {item.currentModel ?? '—'} · 👎 {item.thumbsDown}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid={`ops-eval-trend-toggle-${item.artifact}`}
            onClick={onToggle}
          >
            {expanded ? 'Hide trend' : 'Trend'}
          </Button>
          <Button
            data-testid={`ops-eval-reeval-${item.artifact}`}
            disabled={pending}
            onClick={() => void onReeval(item.artifact)}
          >
            {pending ? 'Re-evaluating…' : 'Re-eval now'}
          </Button>
        </div>
      </div>

      {item.latest && (
        <ul
          data-testid={`ops-eval-cases-${item.artifact}`}
          className="flex flex-wrap gap-1"
        >
          {item.latest.perCase.map((c) => (
            <li
              key={c.id}
              data-testid={`ops-eval-case-${item.artifact}-${c.id}`}
              data-regressed={!c.passed || undefined}
              title={c.detail}
              className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                c.passed
                  ? 'border border-[var(--color-border)] text-[var(--color-muted)]'
                  : 'border border-[var(--color-accent)] text-[var(--color-fg)]'
              }`}
            >
              {c.id}
            </li>
          ))}
        </ul>
      )}
      {!item.latest && (
        <p className="text-xs text-[var(--color-muted)]">Never re-evaluated.</p>
      )}

      {expanded && <EvalTrend artifact={item.artifact} />}
    </li>
  );
}

/** Ops "Evals/Health" tab (Slice 32, Task 21) — the browser surface over
 *  Task 19/20's read-only health rollup + re-eval enqueue routes. Per
 *  artifact×model: baseline `ManifestEntry.verifiedWith` vs the latest
 *  `eval_history` verdict, a per-case grid with regressed cases highlighted
 *  (`data-regressed`), a "re-eval now" action (`useReeval`, mirrors
 *  `useJobActions`'s POST + `refresh()` shape — the pending flag here IS
 *  this tab's optimistic UI, applied before the request and cleared once it
 *  settles), and an on-demand trend (`EvalTrend`, mounted only while a row
 *  is expanded so switching rows never accumulates parallel `eval_history`
 *  fetches). The 👎 `chat.feedback` count is always shown — 0 today, since
 *  no feature writes it yet (expected, per the brief). */
export function EvalsTab() {
  const { page, error, refresh } = useEvals();
  const { reevalArtifact, reevalAll } = useReeval(refresh);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<Set<string>>(new Set());

  function toggleTrend(artifact: string) {
    setExpanded((prev) => (prev === artifact ? undefined : artifact));
  }

  async function runReeval(ref: string) {
    setPending((prev) => new Set(prev).add(ref));
    try {
      await reevalArtifact(ref);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(ref);
        return next;
      });
    }
  }

  return (
    <section data-testid="ops-evals" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm text-[var(--color-fg)]">
          Evals / Health
        </h2>
        <Button
          data-testid="ops-eval-reeval-all"
          onClick={() => void reevalAll()}
        >
          Re-eval all
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-muted)]">
          <strong className="text-[var(--color-fg)]">Eval health</strong> failed
          to load. {error}
        </p>
      )}

      {!error && !page && (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      )}

      {!error && page && page.items.length === 0 && (
        <p className="text-sm text-[var(--color-muted)]">
          No generated artifacts yet.
        </p>
      )}

      {!error && page && page.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {page.items.map((item) => (
            <EvalRow
              key={item.artifact}
              item={item}
              expanded={expanded === item.artifact}
              onToggle={() => toggleTrend(item.artifact)}
              onReeval={runReeval}
              pending={pending.has(item.artifact)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
