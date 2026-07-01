import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { runFlow } from '../../src/cli/flow.ts';
import type { VerifyDeps } from '../../src/verification/types.ts';
import { defineWorkflow } from '../../src/workflow/define.ts';
import { StepKind } from '../../src/workflow/types.ts';

const cannedAgent = (name: string) => ({
  name,
  description: name,
  model: new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'summary text' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  }),
  systemPrompt: 'x',
  tools: {},
});

describe('runFlow', () => {
  it('writes spans.jsonl with workflow spans + result.txt on success', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'flow-'));
    const def = defineWorkflow({
      id: 'demo',
      steps: [
        {
          id: 'sum',
          kind: StepKind.Agent,
          agent: 'web_fetch',
          input: () => 'do it',
          output: z.string(),
        },
      ],
    });
    const outcome = await runFlow({
      def,
      input: 'hello',
      runsRoot,
      runId: 'r1',
      agents: { web_fetch: cannedAgent('web_fetch') },
      tools: {},
    });
    expect(outcome.kind).toBe('done');
    const spans = await readFile(join(runsRoot, 'r1', 'spans.jsonl'), 'utf8');
    expect(spans).toContain('workflow.run');
    expect(spans).toContain('workflow.step');
    const result = await readFile(join(runsRoot, 'r1', 'result.txt'), 'utf8');
    expect(result).toContain('summary text');
  });

  it('writes failed.txt and returns failed on a failing step', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'flow-'));
    const def = defineWorkflow({
      id: 'demo',
      steps: [
        {
          id: 'sum',
          kind: StepKind.Agent,
          agent: 'web_fetch',
          input: () => 'do it',
          output: z.number(), // string result → validation failure
        },
      ],
    });
    const outcome = await runFlow({
      def,
      input: null,
      runsRoot,
      runId: 'r2',
      agents: { web_fetch: cannedAgent('web_fetch') },
      tools: {},
    });
    expect(outcome.kind).toBe('failed');
    const failed = await readFile(join(runsRoot, 'r2', 'failed.txt'), 'utf8');
    expect(failed).toContain('sum');
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

  it('verifyDeps present + a plain workflow (no step.verify set) still verifies, and unverified.txt is written on abstain', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'flow-verify-'));
    const def = defineWorkflow({
      id: 'demo-verify',
      steps: [
        {
          id: 'sum',
          kind: StepKind.Agent,
          agent: 'web_fetch',
          input: () => 'do it',
          output: z.string(),
        },
      ],
    });
    const outcome = await runFlow({
      def, // no step.verify set in the fixture
      input: 'hello',
      runsRoot,
      runId: 'r3',
      agents: { web_fetch: cannedAgent('web_fetch') },
      tools: {},
      verifyDeps: fakeVerifyDeps(false),
    });
    expect(outcome.kind).toBe('unverified');
    const unverified = await readFile(
      join(runsRoot, 'r3', 'unverified.txt'),
      'utf8',
    );
    expect(unverified).toContain('draft');
  });

  it('verifyDeps present + a grounded answer -> done, result.txt still resolves the ORIGINAL answer step (not a pass/abstain step)', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'flow-verify-ok-'));
    const def = defineWorkflow({
      id: 'demo-verify-ok',
      steps: [
        {
          id: 'sum',
          kind: StepKind.Agent,
          agent: 'web_fetch',
          input: () => 'do it',
          output: z.string(),
        },
      ],
    });
    const outcome = await runFlow({
      def,
      input: 'hello',
      runsRoot,
      runId: 'r4',
      agents: { web_fetch: cannedAgent('web_fetch') },
      tools: {},
      verifyDeps: fakeVerifyDeps(true),
    });
    expect(outcome.kind).toBe('done');
    const result = await readFile(join(runsRoot, 'r4', 'result.txt'), 'utf8');
    expect(result).toContain('summary text');
  });
});
