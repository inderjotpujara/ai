import {
  type StatusEvent,
  StatusEventSchema,
  StatusEventType,
} from '@contracts';
import type { DataUIPart, UIDataTypes } from 'ai';
import { useCallback, useState } from 'react';

/** Rail progression — enter → model-select → load → running → exit. */
export enum RailPhase {
  Idle = 'idle',
  Starting = 'starting',
  ModelSelect = 'model-select',
  Loading = 'loading',
  Running = 'running',
  Done = 'done',
}

export type RailView = {
  agent?: string;
  model?: string;
  phase: RailPhase;
  degraded: boolean;
};

const INITIAL_VIEW: RailView = { phase: RailPhase.Idle, degraded: false };

/** A pending human-in-the-loop consent ask (`data-confirm`), awaiting an answer. */
export type PendingConfirm = {
  promptId: string;
  kind: string;
  question: string;
};

/** Fold one `StatusEvent` into the current rail view. */
function foldEvent(view: RailView, event: StatusEvent): RailView {
  switch (event.type) {
    case StatusEventType.RunStart:
      return { ...view, phase: RailPhase.Starting };
    case StatusEventType.Provision:
    case StatusEventType.McpMount:
      // Keep it simple: treat as an early-lifecycle signal unless we're
      // already further along the enter->exit progression.
      return view.phase === RailPhase.Idle
        ? { ...view, phase: RailPhase.Starting }
        : view;
    case StatusEventType.ModelSelect:
      // Runtime-fallback degrade rides in on ModelSelect.degraded (select-hook.ts)
      // and emits no separate Degrade event — OR it in, never clobber an
      // already-true flag.
      return {
        ...view,
        model: event.model,
        phase: RailPhase.ModelSelect,
        degraded: view.degraded || event.degraded === true,
      };
    case StatusEventType.ModelLoad:
      return { ...view, phase: RailPhase.Loading };
    case StatusEventType.Delegation:
      return { ...view, agent: event.agent, phase: RailPhase.Running };
    case StatusEventType.Degrade:
      return { ...view, degraded: true };
    case StatusEventType.RunEnd:
      return { ...view, phase: RailPhase.Done };
    default:
      return view;
  }
}

/**
 * Folds transient `StatusEvent` data-parts (never land in `message.parts`,
 * per Spike-A) from `useChat({ onData })` into a live `{ agent, model,
 * phase, degraded }` view for the `<LiveRail>`, plus (Task 15) the current
 * `runId` (from `RunStart`) and any `pendingConfirm` ask (from `Confirm`) so
 * the chat feature can answer human-in-the-loop consent prompts.
 */
export function useStatusEvents() {
  const [view, setView] = useState<RailView>(INITIAL_VIEW);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [pendingConfirm, setPendingConfirm] = useState<
    PendingConfirm | undefined
  >(undefined);

  const handleData = useCallback((part: DataUIPart<UIDataTypes>) => {
    const parsed = StatusEventSchema.safeParse(part.data);
    if (!parsed.success) return; // not a StatusEventType — ignore
    setView((prev) => foldEvent(prev, parsed.data));
    switch (parsed.data.type) {
      case StatusEventType.RunStart:
        setRunId(parsed.data.runId);
        break;
      case StatusEventType.Confirm:
        setPendingConfirm({
          promptId: parsed.data.promptId,
          kind: parsed.data.kind,
          question: parsed.data.question,
        });
        break;
      case StatusEventType.RunEnd:
        setPendingConfirm(undefined);
        break;
      default:
        break;
    }
  }, []);

  const clearConfirm = useCallback(() => setPendingConfirm(undefined), []);

  return { view, handleData, pendingConfirm, runId, clearConfirm };
}
