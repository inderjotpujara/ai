import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { runCrewCli } from '../../src/cli/crew.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { defineCrew } from '../../src/crew/define.ts';
import { type CrewDef, CrewProcess } from '../../src/crew/types.ts';

const crew: CrewDef = defineCrew({
  id: 'demo-crew',
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
      description: 'do',
      expectedOutput: 'x',
      member: 'a',
      output: z.string(),
    },
  ],
});

describe('runCrewCli', () => {
  it('writes spans.jsonl with crew.run + result.txt on success', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'crew-'));
    const outcome = await runCrewCli({
      def: crew,
      input: 'hello',
      runsRoot,
      runId: 'r1',
      tools: {},
      // deps hook: override the agent runner so no real model is needed
      runAgentStep: async () => 'result text',
    } as never);
    expect(outcome.kind).toBe('done');
    const spans = await readFile(join(runsRoot, 'r1', 'spans.jsonl'), 'utf8');
    expect(spans).toContain('crew.run');
    const result = await readFile(join(runsRoot, 'r1', 'result.txt'), 'utf8');
    expect(result).toContain('result text');
  });
});
