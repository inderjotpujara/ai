import { expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { runAgent } from '../../src/core/agent.ts';

test('runAgent rejects when given an already-aborted signal', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => {
      if (abortSignal?.aborted) {
        throw new Error('aborted before generation');
      }
      return {
        content: [{ type: 'text', text: 'should not get here' }],
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
      };
    },
  });

  await expect(
    runAgent({
      model,
      systemPrompt: 'You are a test agent.',
      prompt: 'Say hello.',
      tools: {},
      abortSignal: AbortSignal.abort(),
    }),
  ).rejects.toThrow();
});

test('runAgent completes normally when the signal is not aborted', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => {
      if (abortSignal?.aborted) {
        throw new Error('aborted before generation');
      }
      return {
        content: [{ type: 'text', text: 'hello' }],
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
      };
    },
  });

  const { text } = await runAgent({
    model,
    systemPrompt: 'You are a test agent.',
    prompt: 'Say hello.',
    tools: {},
    abortSignal: new AbortController().signal,
  });
  expect(text).toBe('hello');
});
