import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { VerifyDeps } from '../../src/verification/types.ts';
import { defineWorkflow } from '../../src/workflow/define.ts';
import { runWorkflow } from '../../src/workflow/engine.ts';
import { StepKind, type WorkflowDef } from '../../src/workflow/types.ts';

/** A controllable fake judge: the verdict is driven purely by the claim-check
 *  reply ("Yes"/"No"). decompose always yields one cited claim so the judge
 *  reply alone decides supported/unsupported. Mirrors tests/crew/verify-wiring.test.ts. */
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

function baseDef(verify: boolean): WorkflowDef {
  return {
    id: 'w',
    steps: [
      {
        id: 't1',
        kind: StepKind.Agent,
        agent: 'a',
        input: () => 'answer the question',
        output: z.string(),
        ...(verify ? { verify: true } : {}),
      },
    ],
  };
}

describe('workflow verify wiring', () => {
  test('verify:true + failing judge → outcome surfaces unverified', async () => {
    const def = defineWorkflow(baseDef(true), {
      verifyDeps: fakeVerifyDeps(false),
    });
    const outcome = await runWorkflow(def, 'q', {
      tools: {},
      runAgentStep: async () => 'a draft answer [mem:c#0]',
    });
    expect(outcome.kind).toBe('unverified');
    if (outcome.kind === 'unverified') {
      expect(outcome.unsupportedClaims.length).toBeGreaterThan(0);
      expect(outcome.faithfulness).toBe(0);
      expect(typeof outcome.draft).toBe('string');
      expect(outcome.failedStepId).toBe('t1');
    }
  });

  test('verify:true + passing judge → done, answer passes through', async () => {
    const def = defineWorkflow(baseDef(true), {
      verifyDeps: fakeVerifyDeps(true),
    });
    const outcome = await runWorkflow(def, 'q', {
      tools: {},
      runAgentStep: async () => 'a grounded answer [mem:c#0]',
    });
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      expect(outcome.output.t1).toBe('a grounded answer [mem:c#0]');
    }
  });

  test('no verify flag → unchanged (no verify steps spliced in, outcome as today)', async () => {
    let generateCalls = 0;
    // Even when verifyOpts IS supplied, a step without `verify: true` must not
    // be expanded and verifyDeps must never be touched for it.
    const def = defineWorkflow(baseDef(false), {
      verifyDeps: fakeVerifyDeps(false, {
        generate: async (_m, p) => {
          generateCalls++;
          return p.includes('atomic') ? '[]' : 'No';
        },
      }),
    });
    expect(def.steps.length).toBe(1);
    const outcome = await runWorkflow(def, 'q', {
      tools: {},
      runAgentStep: async () => 'plain answer',
    });
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      expect(outcome.output.t1).toBe('plain answer');
    }
    expect(generateCalls).toBe(0);
  });

  test('no verifyOpts at all → defineWorkflow output identical to before (additive-only)', async () => {
    const def = defineWorkflow(baseDef(false));
    expect(def.steps.length).toBe(1);
    const outcome = await runWorkflow(def, 'q', {
      tools: {},
      runAgentStep: async () => 'plain answer',
    });
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      expect(outcome.output.t1).toBe('plain answer');
    }
  });
});
