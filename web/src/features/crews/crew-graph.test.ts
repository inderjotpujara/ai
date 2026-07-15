import type { CrewDetailDTO } from '@contracts';
import { CrewProcess } from '@contracts';
import { describe, expect, it } from 'vitest';
import { crewGraph } from './crew-graph.ts';

const sequential: CrewDetailDTO = {
  name: 'research-crew',
  process: CrewProcess.Sequential,
  members: [
    {
      name: 'researcher',
      role: 'Research Analyst',
      goal: 'g',
      backstory: 'b',
      requires: [],
      prefer: 'largest-that-fits',
    },
    {
      name: 'writer',
      role: 'Technical Writer',
      goal: 'g',
      backstory: 'b',
      requires: [],
      prefer: 'largest-that-fits',
    },
  ],
  tasks: [
    {
      id: 'gather',
      description: 'd',
      expectedOutput: 'o',
      member: 'researcher',
      dependsOn: [],
    },
    {
      id: 'brief',
      description: 'd',
      expectedOutput: 'o',
      member: 'writer',
      dependsOn: ['gather'],
    },
  ],
};

const hierarchical: CrewDetailDTO = {
  name: 'manager-crew',
  process: CrewProcess.Hierarchical,
  members: [
    {
      name: 'researcher',
      role: 'Research Analyst',
      goal: 'g',
      backstory: 'b',
      requires: [],
      prefer: 'largest-that-fits',
    },
  ],
  tasks: [
    {
      id: 'gather',
      description: 'd',
      expectedOutput: 'o',
      member: 'researcher',
      dependsOn: [],
    },
  ],
};

describe('crewGraph', () => {
  it('sequential: tasks become nodes; deps from dependsOn else the previous task', () => {
    const model = crewGraph(sequential);
    expect(model.nodes.map((n) => n.id)).toEqual(['gather', 'brief']);
    expect(model.nodes[1]?.sublabel).toBe('writer');
    expect(model.edges).toEqual([
      { from: 'gather', to: 'brief', kind: 'depends' },
    ]);
  });

  it('hierarchical: a manager hub delegates to each member; no task DAG', () => {
    const model = crewGraph(hierarchical);
    expect(model.nodes.map((n) => n.id)).toEqual(['__manager__', 'researcher']);
    expect(model.nodes[0]?.kind).toBe('manager');
    expect(model.edges).toEqual([
      { from: '__manager__', to: 'researcher', kind: 'delegates' },
    ]);
  });
});
