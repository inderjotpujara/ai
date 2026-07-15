import type { CrewDetailDTO } from '@contracts';
import { CrewProcess, StepKind } from '@contracts';
import type { DagModel } from '../../shared/dag/types.ts';

const MANAGER_NODE_ID = '__manager__';

/** D7a — process-aware crew→DagModel projection (pure; lives web-side so the
 *  server DTO stays a faithful, process-agnostic projection). Sequential
 *  crews compile to agent steps, so `kind: StepKind.Agent` is honest for
 *  every task node. Hierarchical crews have no static task DAG (the manager
 *  delegates at runtime) — they get a manager hub + delegation star instead;
 *  the crew-detail page shows the task list in a side panel, not the graph. */
export function crewGraph(detail: CrewDetailDTO): DagModel {
  if (detail.process === CrewProcess.Hierarchical) {
    return {
      nodes: [
        { id: MANAGER_NODE_ID, label: 'Manager', kind: 'manager' },
        ...detail.members.map((m) => ({
          id: m.name,
          label: m.name,
          sublabel: m.role,
          kind: StepKind.Agent,
        })),
      ],
      edges: detail.members.map((m) => ({
        from: MANAGER_NODE_ID,
        to: m.name,
        kind: 'delegates' as const,
      })),
    };
  }

  return {
    nodes: detail.tasks.map((task) => ({
      id: task.id,
      label: task.id,
      sublabel: task.member,
      kind: StepKind.Agent,
    })),
    edges: detail.tasks.flatMap((task, index) => {
      if (task.dependsOn.length > 0) {
        return task.dependsOn.map((dep) => ({
          from: dep,
          to: task.id,
          kind: 'depends' as const,
        }));
      }
      const prev = index > 0 ? detail.tasks[index - 1] : undefined;
      return prev
        ? [{ from: prev.id, to: task.id, kind: 'depends' as const }]
        : [];
    }),
  };
}
