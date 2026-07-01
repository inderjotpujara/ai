import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { runCrew } from '../../src/crew/engine.ts';
import { type CrewDef, CrewProcess } from '../../src/crew/types.ts';
import type { VerifyDeps } from '../../src/verification/types.ts';

/** A controllable fake judge: the verdict is driven purely by the claim-check
 *  reply ("Yes"/"No"). decompose always yields one cited claim so the judge
 *  reply alone decides supported/unsupported. */
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
      // rewriteQuery / gradeRetrieval fall through to a benign default
      if (p.includes('Rewrite')) return 'rewritten query';
      if (p.includes('sufficient and relevant')) return 'CORRECT';
      return supported ? 'Yes' : 'No'; // checkClaim
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

function oneTaskCrew(verify: boolean): CrewDef {
  return {
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
    ],
    tasks: [
      {
        id: 't1',
        description: 'answer the question',
        expectedOutput: 'an answer',
        member: 'a',
        output: z.string(),
        verify,
      },
    ],
  };
}

describe('crew verify wiring', () => {
  test('verify:true + failing judge → unverified with unsupportedClaims', async () => {
    const outcome = await runCrew(oneTaskCrew(true), 'q', {
      tools: {},
      runAgentStep: async () => 'a draft answer [mem:c#0]',
      verifyDeps: fakeVerifyDeps(false),
    });
    expect(outcome.kind).toBe('unverified');
    if (outcome.kind === 'unverified') {
      expect(outcome.unsupportedClaims.length).toBeGreaterThan(0);
      expect(outcome.faithfulness).toBe(0);
      expect(typeof outcome.draft).toBe('string');
      expect(outcome.failedTaskId).toBe('t1');
    }
  });

  test('verify:true + passing judge → done', async () => {
    const outcome = await runCrew(oneTaskCrew(true), 'q', {
      tools: {},
      runAgentStep: async () => 'a grounded answer [mem:c#0]',
      verifyDeps: fakeVerifyDeps(true),
    });
    expect(outcome.kind).toBe('done');
  });

  test('no verify flag → unchanged (done, no verify steps run)', async () => {
    let generateCalls = 0;
    const outcome = await runCrew(oneTaskCrew(false), 'q', {
      tools: {},
      runAgentStep: async () => 'plain answer',
      verifyDeps: fakeVerifyDeps(false, {
        generate: async (_m, p) => {
          generateCalls++;
          return p.includes('atomic') ? '[]' : 'No';
        },
      }),
    });
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      expect((outcome.output as Record<string, unknown>).t1).toBe(
        'plain answer',
      );
    }
    // verifyDeps must never be touched when no task opts in.
    expect(generateCalls).toBe(0);
  });

  test('verify:true, gate-1 fails but corrective answer passes → done', async () => {
    let call = 0;
    const outcome = await runCrew(oneTaskCrew(true), 'q', {
      tools: {},
      // first answer bad; corrective re-answer good
      runAgentStep: async () =>
        call++ === 0 ? 'bad [mem:c#0]' : 'good [mem:c#0]',
      // judge says No on the original claim text but Yes once corrective ran;
      // drive it by call count on checkClaim instead.
      verifyDeps: (() => {
        let checks = 0;
        return fakeVerifyDeps(false, {
          generate: async (_m, p) => {
            if (p.includes('atomic factual claims'))
              return '[{"text":"claim","citedIds":["c#0"]}]';
            if (p.includes('Rewrite')) return 'rewritten';
            if (p.includes('sufficient and relevant')) return 'INCORRECT';
            // checkClaim: fail first gate, pass second gate
            return checks++ === 0 ? 'No' : 'Yes';
          },
        });
      })(),
      recall: async () => [
        {
          id: 'c#0',
          text: 'better evidence',
          source: 'kb',
          score: 1,
          namespace: '',
        },
      ],
    });
    expect(outcome.kind).toBe('done');
  });
});
