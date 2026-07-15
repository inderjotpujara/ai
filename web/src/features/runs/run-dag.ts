import type { SpanDTO } from '@contracts';
import { SpanStatus } from '@contracts';
import { DagStatus } from '../../shared/dag/types.ts';

const RUN_GRAPH_ROOTS: ReadonlySet<string> = new Set([
  'workflow.run',
  'crew.run',
]);

export type RunGraphSource = { kind: 'workflow' | 'crew'; id: string };

/**
 * Finds the workflow/crew definition a run's DAG overlay should render, by
 * scanning the live span trace for a recognized root and reading its
 * `workflow.id`/`crew.id` attribute. Scans `spans` directly (rather than
 * gating on `RunDTO.kind`) because the root span — and therefore `kind` — is
 * only written to disk once `span.end()` fires (`telemetry/spans.ts`
 * `inSpan`), and a `workflow.run`/`crew.run` root's wrapped function awaits
 * every nested step, so the root closes LAST. Scanning the live tail resolves
 * at the earliest possible moment: the instant the root closes.
 *
 * This is the cold-open fallback (a run opened from the Runs list, with no
 * `graphKind`/`graphId` search params) — see run-detail.tsx's Amendment A
 * handoff, which resolves the graph from t=0 for the primary launch→watch
 * flow instead of waiting on this scan.
 */
export function findRunGraphSource(
  spans: SpanDTO[],
): RunGraphSource | undefined {
  const root = spans.find((s) => RUN_GRAPH_ROOTS.has(s.name));
  if (!root) return undefined;
  const workflowId = root.attributes['workflow.id'];
  if (typeof workflowId === 'string') {
    return { kind: 'workflow', id: workflowId };
  }
  const crewId = root.attributes['crew.id'];
  if (typeof crewId === 'string') return { kind: 'crew', id: crewId };
  return undefined;
}

/**
 * Overlays live per-step status: a step whose `workflow.step.id`-tagged span
 * has closed is Done (ok) or Error. Spans are only recorded on completion, so
 * a step currently executing has no span yet — there is no reliable
 * "running" signal in this data (see the Task-18 scope note); nodes light up
 * progressively as their spans land rather than showing a synthetic
 * in-progress state. Hierarchical crews have no `workflow.step` spans at all
 * (delegation, not the DAG engine), so this returns `{}` for them — a silent,
 * correct degrade to the DagView default look, not an error.
 */
export function stepStatusOverlay(spans: SpanDTO[]): Record<string, DagStatus> {
  const byId: Record<string, DagStatus> = {};
  for (const span of spans) {
    const stepId = span.attributes['workflow.step.id'];
    if (typeof stepId !== 'string') continue;
    byId[stepId] =
      span.status === SpanStatus.Error ? DagStatus.Error : DagStatus.Done;
  }
  return byId;
}
