import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import {
  buildHierarchicalOrchestrator,
  compileToWorkflow,
} from '../../src/crew/compile.ts';
import { type CrewDef, CrewProcess } from '../../src/crew/types.ts';
import { StepKind } from '../../src/workflow/types.ts';

const crew: CrewDef = {
  id: 'research',
  process: CrewProcess.Sequential,
  members: [
    {
      name: 'researcher',
      role: 'Analyst',
      goal: 'gather',
      backstory: 'b',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
    {
      name: 'writer',
      role: 'Writer',
      goal: 'summarize',
      backstory: 'b',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  ],
  tasks: [
    {
      id: 'gather',
      description: 'Research the topic',
      expectedOutput: 'notes',
      member: 'researcher',
      output: z.string(),
    },
    {
      id: 'write',
      description: 'Write a summary',
      expectedOutput: '3 bullets',
      member: 'writer',
    },
  ],
};

describe('compileToWorkflow', () => {
  it('maps each task to an AgentStep with member as agent + resolved deps', () => {
    const wf = compileToWorkflow(crew);
    expect(wf.id).toBe('research');
    expect(wf.steps).toHaveLength(2);
    const [s0, s1] = wf.steps;
    if (!s0 || !s1) throw new Error('expected two steps');
    expect(s0.kind).toBe(StepKind.Agent);
    expect((s0 as { agent: string }).agent).toBe('researcher');
    expect((s1 as { agent: string }).agent).toBe('writer');
    // second task defaults to depending on the first (CrewAI sequential)
    expect(s1.dependsOn).toEqual(['gather']);
    // task output default -> the step still validates (z.string() when omitted)
    expect(s1.output).toBeDefined();
  });

  it('step input composes the task description + expected output', () => {
    const wf = compileToWorkflow(crew);
    const input = (
      wf.steps[0] as { input: (c: Record<string, unknown>) => string }
    ).input({ input: 'AI safety' });
    expect(input).toContain('Research the topic');
    expect(input).toContain('notes');
    expect(input).toContain('AI safety'); // root task sees the crew input
  });
});

describe('buildHierarchicalOrchestrator', () => {
  it('builds a manager Agent whose tools delegate to each member', () => {
    const orch = buildHierarchicalOrchestrator({
      ...crew,
      process: CrewProcess.Hierarchical,
    });
    // createOrchestrator returns an Agent with delegate_to_<member> tools
    expect(orch.name).toBe('research');
    expect(Object.keys(orch.tools)).toEqual(
      expect.arrayContaining(['delegate_to_researcher', 'delegate_to_writer']),
    );
  });
});
