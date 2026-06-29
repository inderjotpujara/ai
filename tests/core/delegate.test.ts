import { expect, mock, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { asDelegateTool, delegateToolName } from '../../src/core/delegate.ts';

function cannedAgent(name: string, answer: string): Agent {
  return {
    name,
    description: `agent ${name}`,
    model: new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: 'text', text: answer }],
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
    systemPrompt: 'test',
    tools: {},
  };
}

test('delegate tool name is delegate_to_<name>', () => {
  expect(delegateToolName(cannedAgent('file_qa', 'x'))).toBe(
    'delegate_to_file_qa',
  );
});

test('asDelegateTool runs the wrapped agent and returns its text', async () => {
  const t = asDelegateTool(cannedAgent('file_qa', 'the answer'));
  const result = await t.execute?.({ task: 'do it' }, {} as never);
  expect(result).toEqual({ text: 'the answer' });
});

test('asDelegateTool runs onBeforeDelegate before the agent runs', async () => {
  const order: string[] = [];
  const agent = cannedAgent('file_qa', 'answer'); // existing helper in this file
  const hook = mock(async (a: typeof agent) => {
    order.push(`hook:${a.name}`);
  });
  const t = asDelegateTool(agent, hook);
  await t.execute?.({ task: 'go' }, {} as never);
  expect(hook).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['hook:file_qa']); // hook ran (before the agent's own run)
});

function textModel(label: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: label }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

function agent(): Agent {
  return {
    name: 'spec',
    description: 'a specialist',
    model: textModel('DEFAULT MODEL'),
    systemPrompt: 'sp',
    tools: {},
  };
}

test('uses the model override returned by onBeforeDelegate', async () => {
  const t = asDelegateTool(agent(), async () => ({ model: textModel('OVERRIDE MODEL') }));
  const out = await t.execute?.({ task: 'hi' }, { toolCallId: 't', messages: [] });
  expect(out).toEqual({ text: 'OVERRIDE MODEL' });
});

test('abort short-circuits: agent never runs, returns soft error', async () => {
  let ran = false;
  const a = agent();
  a.model = new MockLanguageModelV3({
    doGenerate: async () => {
      ran = true;
      throw new Error('should not run');
    },
  });
  const t = asDelegateTool(a, async () => ({ abort: 'no fit' }));
  const out = await t.execute?.({ task: 'hi' }, { toolCallId: 't', messages: [] });
  expect(out).toEqual({ error: 'no fit' });
  expect(ran).toBe(false);
});
