import { expect, mock, test } from 'bun:test';
import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import {
  type Agent,
  ollamaCtxOptions,
  runDefinedAgent,
} from '../../src/core/agent-def.ts';

test('runDefinedAgent runs the agent on the task and returns text', async () => {
  const execute = mock(async () => ({ value: 42 }));
  const model = new MockLanguageModelV3({
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
  });
  const agent: Agent = {
    name: 'calc',
    description: 'does math',
    model,
    systemPrompt: 'You do math.',
    tools: {
      add: tool({ description: 'add', inputSchema: z.object({}), execute }),
    },
  };

  const { text } = await runDefinedAgent(agent, 'what is 40+2?');
  expect(text).toBe('done');
});

test('ollamaCtxOptions nests num_ctx under ollama.options', () => {
  expect(ollamaCtxOptions(8192)).toEqual({
    ollama: { options: { num_ctx: 8192 } },
  });
});

test('ollamaCtxOptions returns undefined when no context is given', () => {
  expect(ollamaCtxOptions()).toBeUndefined();
});
