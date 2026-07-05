import { afterEach, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { runAgent } from '../../src/core/agent.ts';

afterEach(() => {
  delete process.env.AGENT_RUN_TIMEOUT_MS;
});

test('runAgent rejects with timeout when the model call hangs past the run timeout', async () => {
  process.env.AGENT_RUN_TIMEOUT_MS = '20';

  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return {
        content: [{ type: 'text', text: 'too slow' }],
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
    }),
  ).rejects.toThrow(/timeout/);
});
