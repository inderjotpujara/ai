import { afterEach, beforeEach, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { runDefinedAgent } from '../../src/core/agent-def.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

let exporter: ReturnType<typeof registerTestProvider>['exporter'];
let provider: ReturnType<typeof registerTestProvider>['provider'];

beforeEach(() => {
  ({ exporter, provider } = registerTestProvider());
});

afterEach(async () => {
  await provider.shutdown();
  exporter.reset();
});

test('runDefinedAgent emits an ai.generateText span tagged with the agent name', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
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
    name: 'file_qa',
    description: 'answers from files',
    model,
    systemPrompt: 'you answer',
    tools: {},
  };
  await runDefinedAgent(agent, 'hello');
  const spans = exporter.getFinishedSpans();
  const gen = spans.find((s) => s.name.startsWith('ai.generateText'));
  expect(gen).toBeDefined();
  expect(gen?.attributes['ai.telemetry.functionId']).toBe('file_qa');
});
