import { describe, expect, it } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import type { Agent } from '../../src/core/agent-def.ts';
import {
  DEFAULT_MAX_PARALLEL,
  defaultRunAgentStep,
  runStepByKind,
  type WorkflowDeps,
} from '../../src/workflow/run-step.ts';
import { StepKind } from '../../src/workflow/types.ts';

const baseDeps = (over: Partial<WorkflowDeps> = {}): WorkflowDeps => ({
  runAgentStep: async (_a, task) => `ran:${task}`,
  tools: {},
  ...over,
});

describe('runStepByKind', () => {
  it('agent step calls runAgentStep with the built prompt', async () => {
    const out = await runStepByKind(
      {
        id: 's',
        kind: StepKind.Agent,
        agent: 'web_fetch',
        input: (ctx) => `task:${ctx.input}`,
        output: z.string(),
      },
      { input: 'X' },
      baseDeps(),
    );
    expect(out).toBe('ran:task:X');
  });

  it('tool step calls the tool execute with built args', async () => {
    const out = await runStepByKind(
      {
        id: 's',
        kind: StepKind.Tool,
        tool: 'echo',
        input: () => ({ msg: 'hi' }),
        output: z.object({ echoed: z.string() }),
      },
      {},
      baseDeps({
        tools: {
          echo: {
            description: 'echo',
            inputSchema: z.object({ msg: z.string() }),
            execute: async (args: { msg: string }) => ({ echoed: args.msg }),
          },
        } as unknown as WorkflowDeps['tools'],
      }),
    );
    expect(out).toEqual({ echoed: 'hi' });
  });

  it('branch step returns the taken arm', async () => {
    const out = await runStepByKind(
      {
        id: 'b',
        kind: StepKind.Branch,
        predicate: (ctx) => ctx.input === 'yes',
        whenTrue: 't',
        whenFalse: 'f',
        output: z.object({ taken: z.string() }),
      },
      { input: 'yes' },
      baseDeps(),
    );
    expect(out).toEqual({ taken: 'whenTrue' });
  });

  it('map step fans out over the list and collects results', async () => {
    const out = await runStepByKind(
      {
        id: 'm',
        kind: StepKind.Map,
        over: () => [1, 2, 3],
        step: {
          kind: StepKind.Agent,
          agent: 'web_fetch',
          input: (ctx) => `n=${ctx.item}`,
          output: z.string(),
        },
        output: z.array(z.string()),
      },
      {},
      baseDeps(),
    );
    expect(out).toEqual(['ran:n=1', 'ran:n=2', 'ran:n=3']);
  });

  it('exposes a conservative default concurrency cap', () => {
    expect(DEFAULT_MAX_PARALLEL).toBeGreaterThanOrEqual(1);
  });
});

describe('defaultRunAgentStep', () => {
  it('threads onBeforeDelegate into the guarded agent run', async () => {
    const seen: string[] = [];
    const agent: Agent = {
      name: 'web_fetch',
      description: 'fetches',
      model: new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'done' }],
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
      systemPrompt: 's',
      tools: {},
    };
    const onBeforeDelegate = async (a: Agent) => {
      seen.push(a.name);
    };
    const run = defaultRunAgentStep({ web_fetch: agent }, onBeforeDelegate);
    const out = await run('web_fetch', 'do it');
    expect(out).toBe('done');
    expect(seen).toEqual(['web_fetch']);
  });
});
