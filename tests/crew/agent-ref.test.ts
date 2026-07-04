import { expect, test } from 'bun:test';
import { crewAgentMap } from '../../src/crew/engine.ts';
import { type CrewDef, CrewProcess } from '../../src/crew/types.ts';

test('a member with agentRef resolves to the registered factory', () => {
  const crew: CrewDef = {
    id: 'c',
    process: CrewProcess.Sequential,
    members: [
      {
        name: 'wf',
        agentRef: 'web_fetch',
        role: 'r',
        goal: 'g',
        backstory: 'b',
        requires: [],
        prefer: 'largest-that-fits' as never,
      },
    ],
    tasks: [{ id: 't', description: 'd', expectedOutput: 'o', member: 'wf' }],
  };
  const map = crewAgentMap(crew, {});
  expect(map.wf?.name).toBe('web_fetch'); // came from the registered agent, not a fresh inline build
});
