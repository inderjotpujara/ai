import type { RunListItemDTO } from '@contracts';
import { RunKind, RunLifecycle } from '@contracts';

export type RunNotifyEvent = {
  runId: string;
  kind: RunKind;
  durationMs: number;
};

export type NotifyDiffOptions = { baseline: boolean; minDurationMs: number };
export type NotifyDiffResult = {
  nextSeen: Map<string, RunLifecycle>;
  toNotify: RunNotifyEvent[];
};

/** Long-running kinds worth notifying about — a chat turn never fires one
 *  (spec D11/§7.2 requirement d). Checked BEFORE the transition test. */
const NOTIFIABLE_KINDS: ReadonlySet<RunKind> = new Set([
  RunKind.Crew,
  RunKind.Workflow,
  RunKind.Agent,
]);

function isTerminal(lifecycle: RunLifecycle): boolean {
  return lifecycle === RunLifecycle.Done || lifecycle === RunLifecycle.Failed;
}

/**
 * Pure baseline-then-diff over one `GET /api/runs` poll tick (spec §7.2 —
 * the hard part). `prevSeen` is the hook's running `Map<runId, RunLifecycle>`
 * from the PREVIOUS tick; `opts.baseline` is true only for the very first
 * poll after mount, which seeds `nextSeen` but never notifies (requirement
 * a) — this is what keeps pre-existing terminal runs from firing on load.
 * Every later tick fires exactly once per run that was last recorded
 * `Running` and is now `Done`/`Failed` past `minDurationMs` (requirement b:
 * the guard is specifically "was Running", not "was non-terminal" or
 * "wasn't already terminal" — a run that skips straight from Queued/Paused
 * to terminal without ever being observed Running does NOT fire, matching
 * the spec's literal "last seen Running" wording). Once a run fires, its map
 * entry becomes the terminal lifecycle, which makes the `Running->terminal`
 * guard permanently false for it afterward — dedup falls out of the data
 * structure with no extra `Set` (requirement: no double-fire). The kind
 * filter is applied first (requirement d), and `nextSeen` always carries
 * forward every prior entry via the `new Map(prevSeen)` copy, even for a
 * runId absent from THIS tick's `items` — a hidden-tab caller (T59's hook)
 * must never construct `nextSeen` from `items` alone, or a run missing from
 * one page would be silently forgotten (requirement c is the hook's job to
 * uphold across ticks; this function's job is to never itself drop an
 * existing entry).
 */
export function diffRunNotifications(
  prevSeen: Map<string, RunLifecycle>,
  items: RunListItemDTO[],
  opts: NotifyDiffOptions,
): NotifyDiffResult {
  const nextSeen = new Map(prevSeen);
  const toNotify: RunNotifyEvent[] = [];

  for (const item of items) {
    if (!NOTIFIABLE_KINDS.has(item.kind)) continue;

    const prevLifecycle = prevSeen.get(item.id);
    const qualifies =
      !opts.baseline &&
      prevLifecycle === RunLifecycle.Running &&
      isTerminal(item.lifecycle) &&
      item.durationMs > opts.minDurationMs;

    if (qualifies) {
      toNotify.push({
        runId: item.id,
        kind: item.kind,
        durationMs: item.durationMs,
      });
    }
    nextSeen.set(item.id, item.lifecycle);
  }

  return { nextSeen, toNotify };
}
