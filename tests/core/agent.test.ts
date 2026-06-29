import { expect, mock, test } from 'bun:test';
import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { runAgent } from '../../src/core/agent.ts';
import { MaxStepsError } from '../../src/core/errors.ts';

test('agent calls the tool then returns the final answer', async () => {
  const execute = mock(async ({ path }: { path: string }) => ({
    text: `contents of ${path}`,
  }));

  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      call += 1;
      if (call === 1) {
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'read_file',
              input: JSON.stringify({ path: '/tmp/x.txt' }),
            },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
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
      }
      return {
        content: [{ type: 'text', text: 'The file says hello.' }],
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

  const tools = {
    read_file: tool({
      description: 'read a file',
      inputSchema: z.object({ path: z.string() }),
      execute,
    }),
  };

  const { text, steps } = await runAgent({
    model,
    systemPrompt: 'You answer questions about files.',
    prompt: 'What does /tmp/x.txt say?',
    tools,
  });

  expect(execute).toHaveBeenCalledWith(
    { path: '/tmp/x.txt' },
    expect.anything(),
  );
  expect(text).toBe('The file says hello.');
  expect(Array.isArray(steps)).toBe(true);
  expect(steps.length).toBeGreaterThanOrEqual(2);
});

test('runAgent throws MaxStepsError when step ceiling is hit without a final answer', async () => {
  // A model that always returns a tool-call (never produces final text), so the
  // loop exhausts maxSteps and generateText stops with finishReason != 'stop'.
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'noop_tool',
          input: JSON.stringify({}),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: undefined },
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

  const tools = {
    noop_tool: tool({
      description: 'does nothing',
      inputSchema: z.object({}),
      execute: async () => ({ result: 'ok' }),
    }),
  };

  await expect(
    runAgent({
      model,
      systemPrompt: 'You are a test agent.',
      prompt: 'Run forever.',
      tools,
      maxSteps: 2,
    }),
  ).rejects.toBeInstanceOf(MaxStepsError);
});
