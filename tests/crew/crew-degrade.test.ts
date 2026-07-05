import { describe, expect, it } from 'bun:test';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { runCrew } from '../../src/crew/engine.ts';
import { type CrewDef, CrewProcess } from '../../src/crew/types.ts';
import { createLedger } from '../../src/reliability/ledger.ts';

const seqCrew: CrewDef = {
  id: 'c-degrade',
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
  ],
  tasks: [
    {
      id: 't1',
      description: 'do it',
      expectedOutput: 'x',
      member: 'a',
    },
  ],
};

describe('runCrew ledger', () => {
  it('accepts a ledger in deps without breaking a normal run', async () => {
    const ledger = createLedger();
    const outcome = await runCrew(seqCrew, 'topic', {
      tools: {},
      ledger,
      runAgentStep: async (member) => `${member}:ok`,
    });
    expect(outcome.kind).toBe('done');
    expect(ledger.events).toHaveLength(0);
  });
});
