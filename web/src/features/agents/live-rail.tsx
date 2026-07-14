import { RailPhase, type RailView } from './use-status-events.ts';

const PHASE_LABEL: Record<RailPhase, string> = {
  [RailPhase.Idle]: 'idle',
  [RailPhase.Starting]: 'starting',
  [RailPhase.ModelSelect]: 'model select',
  [RailPhase.Loading]: 'loading',
  [RailPhase.Running]: 'running',
  [RailPhase.Done]: 'done',
};

/**
 * Compact, token-styled status strip showing the enter -> model-select ->
 * load -> running -> exit progression folded by `useStatusEvents`. Renders a
 * minimal placeholder while idle so it never intrudes before a run starts.
 */
export function LiveRail({ view }: { view: RailView }) {
  const isIdle = view.phase === RailPhase.Idle;

  return (
    <div
      data-testid="live-rail"
      className="flex min-h-[1.75rem] items-center gap-2 border-b border-[var(--color-border)] px-3 py-1 font-mono text-xs text-[var(--color-muted)]"
    >
      {isIdle ? (
        <span aria-hidden className="opacity-50">
          &middot;
        </span>
      ) : (
        <>
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
          />
          {view.agent ? (
            <span className="text-[var(--color-fg)]">{view.agent}</span>
          ) : null}
          {view.model ? (
            <span className="text-[var(--color-muted)]">{view.model}</span>
          ) : null}
          <span className="text-[var(--color-accent)]">
            {PHASE_LABEL[view.phase]}
          </span>
        </>
      )}
      {/* Degraded marker sits outside the phase switch so it shows even if a
          Degrade / ModelSelect{degraded} races ahead of RunStart (phase Idle). */}
      {view.degraded ? (
        <span
          data-testid="live-rail-degraded"
          className="rounded bg-[var(--color-signal)]/15 px-1.5 py-0.5 text-[var(--color-signal)]"
        >
          degraded
        </span>
      ) : null}
    </div>
  );
}
