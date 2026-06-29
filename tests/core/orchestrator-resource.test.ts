import { expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { ResourceError } from '../../src/core/errors.ts';
import { runOrchestrator } from '../../src/core/orchestrator.ts';

function answeringAgent(): Agent {
  return {
    name: 'orch',
    description: 'orchestrator',
    systemPrompt: 'sp',
    tools: {},
    model: new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'a normal answer' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: undefined, reasoning: undefined },
        },
        warnings: [],
      }),
    }),
  };
}

test('captured ResourceError yields kind:resource, overriding the answer', async () => {
  const capture = { error: new ResourceError('no model fits') };
  const result = await runOrchestrator(answeringAgent(), 'do it', undefined, capture);
  expect(result.kind).toBe('resource');
  if (result.kind === 'resource') {
    expect(result.message).toBe('no model fits');
  }
});

test('no capture -> normal answer path unaffected', async () => {
  const result = await runOrchestrator(answeringAgent(), 'do it', undefined, {});
  expect(result.kind).toBe('answer');
});
