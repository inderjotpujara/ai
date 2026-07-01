import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { buildCrewAgent } from '../../src/crew/member-agent.ts';
import type { CrewMember } from '../../src/crew/types.ts';

const member: CrewMember = {
  name: 'researcher',
  role: 'Senior Research Analyst',
  goal: 'Find accurate, current facts on the topic',
  backstory: 'You have 10 years scouring primary sources.',
  requires: [Capability.Tools],
  prefer: PreferPolicy.LargestThatFits,
};

describe('buildCrewAgent', () => {
  it('composes role/goal/backstory into the system prompt', () => {
    const agent = buildCrewAgent(member, {});
    expect(agent.name).toBe('researcher');
    expect(agent.systemPrompt).toContain('Senior Research Analyst');
    expect(agent.systemPrompt).toContain('Find accurate, current facts');
    expect(agent.systemPrompt).toContain('10 years scouring');
    // description drives hierarchical routing → carries role + goal
    expect(agent.description).toContain('Senior Research Analyst');
  });

  it('sets modelReq for live selection, not a hardcoded model choice', () => {
    const agent = buildCrewAgent(member, {});
    expect(agent.modelReq).toEqual({
      role: 'Senior Research Analyst',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    });
    // a default model is present (overridden live by the selector at delegation)
    expect(agent.model).toBeDefined();
  });

  it('uses the member tools when provided', () => {
    const tools = {
      probe: {
        description: 'x',
        inputSchema: z.object({}),
        execute: async () => ({}),
      },
    };
    const agent = buildCrewAgent({ ...member, tools } as CrewMember);
    expect(agent.tools).toBe(tools);
  });
});
