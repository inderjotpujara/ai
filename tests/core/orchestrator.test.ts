import { expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import {
  createOrchestrator,
  runOrchestrator,
} from '../../src/core/orchestrator.ts';

// A sub-agent whose model returns a fixed answer; spy via the model's doGenerate.
function subAgent(
  name: string,
  answer: string,
): { agent: Agent; ran: () => number } {
  let calls = 0;
  const agent: Agent = {
    name,
    description: `handles ${name} tasks`,
    model: new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1;
        return {
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
        };
      },
    }),
    systemPrompt: 'sub',
    tools: {},
  };
  return { agent, ran: () => calls };
}

// Orchestrator model that emits a single tool-call to `toolName`, then (turn 2) final text.
function orchModel(toolName: string, input: unknown) {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      call += 1;
      if (call === 1) {
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName,
              input: JSON.stringify(input),
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
        content: [{ type: 'text', text: 'orchestrator final text' }],
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
}

test('delegation path: orchestrator delegates and returns kind:answer', async () => {
  const { agent, ran } = subAgent('file_qa', 'fox and dog');
  const orch = createOrchestrator({
    model: orchModel('delegate_to_file_qa', { task: 'read it' }),
    systemPrompt: 'route',
    agents: [agent],
  });
  const result = await runOrchestrator(orch, 'what does the file say?');
  expect(result.kind).toBe('answer');
  expect(ran()).toBe(1); // the sub-agent ran
});

test('capability-gap path: returns kind:gap and runs no sub-agent', async () => {
  const { agent, ran } = subAgent('file_qa', 'should not run');
  const orch = createOrchestrator({
    model: orchModel('report_capability_gap', {
      missingCapability: 'book a flight',
    }),
    systemPrompt: 'route',
    agents: [agent],
  });
  const result = await runOrchestrator(orch, 'book me a flight');
  expect(result.kind).toBe('gap');
  if (result.kind === 'gap') {
    expect(result.missingCapability).toBe('book a flight');
    expect(result.message).toContain('book a flight');
  }
  expect(ran()).toBe(0); // no sub-agent ran
});

test('multi-agent selection: only the chosen delegate runs', async () => {
  const a = subAgent('file_qa', 'A');
  const b = subAgent('calc', 'B');
  const orch = createOrchestrator({
    model: orchModel('delegate_to_calc', { task: '2+2' }),
    systemPrompt: 'route',
    agents: [a.agent, b.agent],
  });
  const result = await runOrchestrator(orch, 'compute 2+2');
  expect(result.kind).toBe('answer');
  expect(a.ran()).toBe(0);
  expect(b.ran()).toBe(1);
});
