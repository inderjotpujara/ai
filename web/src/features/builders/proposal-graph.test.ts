import { StepKind } from '@contracts';
import { describe, expect, it } from 'vitest';
import { DagStatus } from '../../shared/dag/types.ts';
import { agentProposalGraph } from './proposal-graph.ts';

describe('agentProposalGraph', () => {
  it('projects the agent node + one node per suggested server, linked by delegates edges', () => {
    const graph = agentProposalGraph({
      name: 'stock_quotes',
      description: 'Fetches live stock quotes',
      systemPrompt: 'x',
      modelReq: { role: 'r', requires: ['tools'], prefer: 'largest-that-fits' },
      suggestedServers: [{ packName: 'finance', scopeToAgent: 'stock_quotes' }],
      rationale: 'why',
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toMatchObject({
      id: 'stock_quotes',
      kind: 'manager',
      status: DagStatus.Done,
    });
    expect(graph.nodes[1]).toMatchObject({
      id: 'stock_quotes::finance',
      kind: StepKind.Tool,
    });
    expect(graph.edges).toEqual([
      { from: 'stock_quotes', to: 'stock_quotes::finance', kind: 'delegates' },
    ]);
  });

  it('projects a node with no edges when there are no suggested servers', () => {
    const graph = agentProposalGraph({
      name: 'solo_agent',
      description: 'd',
      systemPrompt: 'x',
      modelReq: { role: 'r', requires: [], prefer: 'largest-that-fits' },
      suggestedServers: [],
      rationale: 'why',
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
  });
});
