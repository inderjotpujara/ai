import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { runCrewCli } from '../../src/cli/crew.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { defineCrew } from '../../src/crew/define.ts';
import {
  type CrewDef,
  type CrewOutcome,
  CrewProcess,
} from '../../src/crew/types.ts';
import { createRun } from '../../src/run/run-store.ts';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
import type { VerifyDeps } from '../../src/verification/types.ts';

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

function fakeVerifyDeps(
  supported: boolean,
  over: Partial<VerifyDeps> = {},
): VerifyDeps {
  return {
    generalModel: 'g',
    ensureJudge: async (m: string) => ({ model: m, fallback: false }),
    generate: async (_m: string, p: string) => {
      if (p.includes('atomic factual claims'))
        return '[{"text":"claim","citedIds":["c#0"]}]';
      return supported ? 'Yes' : 'No';
    },
    getByIds: async (_s: string, ids: string[]) =>
      ids.map((id) => ({
        id,
        text: 'evidence text',
        source: 'kb',
        score: 0,
        namespace: '',
      })),
    ...over,
  };
}

describe('runCrewCli', () => {
  it('writes spans.jsonl with crew.run + result.txt on success', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'crew-'));
    const run = await createRun(runsRoot, 'r1');
    const tel = initRunTelemetry(run.dir);
    let outcome: CrewOutcome;
    try {
      outcome = await runCrewCli({
        def: crew,
        input: 'hello',
        run,
        tools: {},
        // deps hook: override the agent runner so no real model is needed
        runAgentStep: async () => 'result text',
      } as never);
    } finally {
      await tel.shutdown();
    }
    expect(outcome.kind).toBe('done');
    const spans = await readFile(join(runsRoot, 'r1', 'spans.jsonl'), 'utf8');
    expect(spans).toContain('crew.run');
    const result = await readFile(join(runsRoot, 'r1', 'result.txt'), 'utf8');
    expect(result).toContain('result text');
  });

  it('verifyDeps present + a plain crew (no verify flags set) still verifies, and unverified.txt is written on abstain', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'crew-verify-'));
    const run = await createRun(runsRoot, 'r2');
    const tel = initRunTelemetry(run.dir);
    let outcome: CrewOutcome;
    try {
      outcome = await runCrewCli({
        def: crew, // no task.verify / crew.verify set in the fixture
        input: 'hello',
        run,
        tools: {},
        runAgentStep: async () => 'a draft answer [mem:c#0]',
        verifyDeps: fakeVerifyDeps(false),
      });
    } finally {
      await tel.shutdown();
    }
    expect(outcome.kind).toBe('unverified');
    const unverified = await readFile(
      join(runsRoot, 'r2', 'unverified.txt'),
      'utf8',
    );
    expect(unverified).toContain('draft');
  });

  it('verifyDeps present + a grounded answer -> done, result.txt written', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'crew-verify-ok-'));
    const run = await createRun(runsRoot, 'r3');
    const tel = initRunTelemetry(run.dir);
    let outcome: CrewOutcome;
    try {
      outcome = await runCrewCli({
        def: crew,
        input: 'hello',
        run,
        tools: {},
        runAgentStep: async () => 'a grounded answer [mem:c#0]',
        verifyDeps: fakeVerifyDeps(true),
      });
    } finally {
      await tel.shutdown();
    }
    expect(outcome.kind).toBe('done');
    const result = await readFile(join(runsRoot, 'r3', 'result.txt'), 'utf8');
    expect(result).toContain('grounded answer');
  });
});
