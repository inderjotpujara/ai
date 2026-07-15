import type { WorkflowDetailDTO } from '@contracts';
import type { DagModel } from './types.ts';

/** Pure projection of a workflow definition to the generic DAG model: nodes
 *  = steps (label = step id, sublabel = the step's agent/tool, kind = the
 *  step's own StepKind — honest, no relabeling); edges = `detail.edges`
 *  verbatim (already `depends`/`branch-true`/`branch-false`, derived
 *  server-side by `workflow-dto.ts`'s `effectiveDeps` — never re-derived here). */
export function workflowGraph(detail: WorkflowDetailDTO): DagModel {
  return {
    nodes: detail.steps.map((step) => ({
      id: step.id,
      label: step.id,
      sublabel: step.agent ?? step.tool ?? undefined,
      kind: step.kind,
    })),
    edges: detail.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
    })),
  };
}
