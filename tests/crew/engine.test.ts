import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { runCrew } from '../../src/crew/engine.ts';
import { type CrewDef, CrewProcess } from '../../src/crew/types.ts';

const seqCrew: CrewDef = {
  id: 'c',
  process: CrewProcess.Sequential,
  members: [
    {
      name: 'a',
      role: 'A',
      goal: 'g',
      backstory: 'b',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
    {
      name: 'b',
      role: 'B',
      goal: 'g',
      backstory: 'b',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  ],
  tasks: [
    {
      id: 't1',
      description: 'do first',
      expectedOutput: 'x',
      member: 'a',
      output: z.string(),
    },
    {
      id: 't2',
      description: 'do second',
      expectedOutput: 'y',
      member: 'b',
      output: z.string(),
    },
  ],
};

describe('runCrew (sequential)', () => {
  it('threads task output as context to the next task', async () => {
    const seen: string[] = [];
    const outcome = await runCrew(seqCrew, 'topic', {
      tools: {},
      // stub the agent runner: echo which member + whether it saw upstream context
      runAgentStep: async (member, task) => {
        seen.push(member);
        return `${member}:${task.includes('t1') ? 'saw-t1' : 'root'}`;
      },
    });
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      const out = outcome.output as Record<string, unknown>;
      expect(out.t1).toBe('a:root');
      expect(out.t2).toBe('b:saw-t1'); // t2's prompt embedded t1's output under "Context from \"t1\""
    }
    expect(seen).toEqual(['a', 'b']);
  });

  it('reports a failed task via the outcome', async () => {
    const outcome = await runCrew(seqCrew, 'topic', {
      tools: {},
      runAgentStep: async (member) => {
        if (member === 'b') throw new Error('boom');
        return 'ok';
      },
    });
    expect(outcome).toMatchObject({ kind: 'failed', failedTask: 't2' });
  });
});
