import type { AgentProposalDTO } from '@contracts';
import { StepKind } from '@contracts';
import type { DagModel } from '../../shared/dag/types.ts';
import { DagStatus } from '../../shared/dag/types.ts';

/** Pure projection of a committed `AgentProposalDTO` (`BuildResultDTO.proposal`
 *  on a `written` agent build) to D6's small 2-tier `DagModel`: the agent
 *  node, plus one node per suggested MCP server, connected by a `delegates`
 *  edge (the same edge kind a hierarchical-crew manager→member link already
 *  renders dashed — visually apt for "the agent reaches for this tool" too).
 *  Rendered `DagStatus.Done` — see the task's design note for why this is a
 *  post-write, not pre-consent, preview this increment. */
export function agentProposalGraph(p: AgentProposalDTO): DagModel {
  return {
    nodes: [
      {
        id: p.name,
        label: p.name,
        sublabel: p.description,
        kind: 'manager',
        status: DagStatus.Done,
      },
      ...p.suggestedServers.map((s) => ({
        id: `${p.name}::${s.packName}`,
        label: s.packName,
        sublabel: `scoped to ${s.scopeToAgent}`,
        kind: StepKind.Tool,
        status: DagStatus.Done,
      })),
    ],
    edges: p.suggestedServers.map((s) => ({
      from: p.name,
      to: `${p.name}::${s.packName}`,
      kind: 'delegates' as const,
    })),
  };
}
