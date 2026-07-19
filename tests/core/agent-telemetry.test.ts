import { afterEach, beforeEach, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { runDefinedAgent } from '../../src/core/agent-def.ts';
import { aiSdkTelemetryIntegration } from '../../src/telemetry/ai-sdk.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

/** A mock model that reports one text token; reused across the tests below. */
function okModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
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
}

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
  const agent: Agent = {
    name: 'file_qa',
    description: 'answers from files',
    model: okModel(),
    systemPrompt: 'you answer',
    tools: {},
  };
  await runDefinedAgent(agent, 'hello');
  const spans = exporter.getFinishedSpans();
  const gen = spans.find((s) => s.name.startsWith('ai.generateText'));
  expect(gen).toBeDefined();
  expect(gen?.attributes['ai.telemetry.functionId']).toBe('file_qa');
});

test('a bare generateText (no telemetry.integrations) emits NO ai.* spans — leak closed', async () => {
  // Mirrors the builder/verify (generateText) and memory (embedMany) call
  // sites that pass no telemetry option. Because src/telemetry/ai-sdk.ts no
  // longer calls registerTelemetry globally, the SDK's telemetry dispatcher
  // falls back to the EMPTY global registry for such calls and emits nothing —
  // exactly v6's opt-in scope. (Merely importing ai-sdk.ts above must not have
  // registered a global integration; this asserts that.)
  await generateText({ model: okModel(), prompt: 'hello' });
  const aiSpans = exporter
    .getFinishedSpans()
    .filter((s) => s.name.startsWith('ai.'));
  expect(aiSpans).toHaveLength(0);
});

test('generateText WITH telemetry.integrations does emit an ai.generateText span', async () => {
  // The other half of the scope guarantee: the per-call integration runAgent
  // passes is what turns emission ON, so only opted-in calls produce ai.* spans.
  await generateText({
    model: okModel(),
    prompt: 'hello',
    telemetry: { isEnabled: true, integrations: [aiSdkTelemetryIntegration] },
  });
  const gen = exporter
    .getFinishedSpans()
    .find((s) => s.name.startsWith('ai.generateText'));
  expect(gen).toBeDefined();
});
