import type { WorkflowDetailDTO } from '@contracts';
import { StepKind } from '@contracts';
import { describe, expect, it } from 'vitest';
import { workflowGraph } from './workflow-graph.ts';

const fixture: WorkflowDetailDTO = {
  id: 'fetch-then-summarize',
  steps: [
    { id: 'fetch', kind: StepKind.Tool, tool: 'fetch' },
    { id: 'summarize', kind: StepKind.Agent, agent: 'web_fetch' },
  ],
  edges: [{ from: 'fetch', to: 'summarize', kind: 'depends' }],
};

describe('workflowGraph', () => {
  it('projects steps to nodes (label = id, sublabel = agent/tool) and edges verbatim', () => {
    const model = workflowGraph(fixture);
    expect(model.nodes).toEqual([
      { id: 'fetch', label: 'fetch', sublabel: 'fetch', kind: StepKind.Tool },
      {
        id: 'summarize',
        label: 'summarize',
        sublabel: 'web_fetch',
        kind: StepKind.Agent,
      },
    ]);
    expect(model.edges).toEqual([
      { from: 'fetch', to: 'summarize', kind: 'depends' },
    ]);
  });
});
