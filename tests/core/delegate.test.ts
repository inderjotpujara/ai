import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import {
  asDelegateTool,
  delegateToolName,
  runGuardedAgent,
} from '../../src/core/delegate.ts';
import {
  runInDelegationContext,
  withRootDelegationContext,
} from '../../src/core/guardrails.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

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

function agent(): Agent {
  return {
    name: 'spec',
    description: 'a specialist',
    model: textModel('DEFAULT MODEL'),
    systemPrompt: 'sp',
    tools: {},
  };
}

function leaf(name: string, text: string): Agent {
  return {
    name,
    description: `${name} agent`,
    model: textModel(text),
    systemPrompt: 's',
    tools: {},
  };
}

test('uses the model override returned by onBeforeDelegate', async () => {
  const t = asDelegateTool(agent(), async () => ({
    model: textModel('OVERRIDE MODEL'),
  }));
  const out = await t.execute?.(
    { task: 'hi' },
    { toolCallId: 't', messages: [], context: {} },
  );
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
  const out = await t.execute?.(
    { task: 'hi' },
    { toolCallId: 't', messages: [], context: {} },
  );
  expect(out).toEqual({ error: 'no fit' });
  expect(ran).toBe(false);
});

// --- delegation span + guardrails tests ---

let spanExporter: ReturnType<typeof registerTestProvider>['exporter'];
let spanProvider: ReturnType<typeof registerTestProvider>['provider'];

beforeEach(() => {
  ({ exporter: spanExporter, provider: spanProvider } = registerTestProvider());
});

afterEach(async () => {
  await spanProvider.shutdown();
  spanExporter.reset();
  delete process.env.AGENT_MAX_DELEGATION_DEPTH;
});

test('asDelegateTool opens an agent.delegation span tagged with the target', async () => {
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
  const delegateAgent: Agent = {
    name: 'web_fetch',
    description: 'fetches',
    model,
    systemPrompt: 's',
    tools: {},
  };
  const tool = asDelegateTool(delegateAgent);
  await tool.execute?.(
    { task: 'go' },
    { toolCallId: 't', messages: [], context: {} },
  );
  const del = spanExporter
    .getFinishedSpans()
    .find((s) => s.name === 'agent.delegation');
  expect(del).toBeDefined();
  expect(del?.attributes['agent.delegation.target']).toBe('web_fetch');
});

test('over-depth delegation returns a soft error and records a guardrail event', async () => {
  process.env.AGENT_MAX_DELEGATION_DEPTH = '1'; // allow depth 1 only
  const target = leaf('deep', 'answer');
  const t = asDelegateTool(target);
  // simulate already being at depth 1 (one delegation deep) → this call would be depth 2 → rejected
  const result = await runInDelegationContext(
    'parent',
    8192,
    async () =>
      await t.execute?.(
        { task: 'go' },
        { toolCallId: 'c', messages: [], context: {} },
      ),
  );
  expect(result).toEqual({ error: expect.stringContaining('depth limit') });
});

test('long delegated return is truncated to the caller live cap', async () => {
  const big = 'y'.repeat(9000);
  const t = asDelegateTool(leaf('big', big));
  // caller num_ctx 8192 → cap = 0.25*8192*4 = 8192
  const result = await withRootDelegationContext(
    8192,
    async () =>
      await t.execute?.(
        { task: 'go' },
        { toolCallId: 'c', messages: [], context: {} },
      ),
  );
  if (
    result == null ||
    typeof result !== 'object' ||
    !('text' in result) ||
    typeof result.text !== 'string'
  ) {
    throw new Error('expected text result');
  }
  expect(result.text.length).toBeLessThan(9000);
  expect(result.text).toContain('…[truncated');
});

test('runGuardedAgent returns concise text and emits an agent.delegation span', async () => {
  const result = await withRootDelegationContext(8192, () =>
    runGuardedAgent(cannedAgent('web_fetch', 'done'), 'summarize'),
  );
  expect(result).toEqual({ text: 'done' });
  const del = spanExporter
    .getFinishedSpans()
    .find((s) => s.name === 'agent.delegation');
  expect(del?.attributes['agent.delegation.target']).toBe('web_fetch');
});

test('within-depth recursive re-entry of the same agent name is allowed', async () => {
  const t = asDelegateTool(leaf('rec', 'ok'));
  const result = await runInDelegationContext(
    'rec',
    8192,
    async () =>
      await t.execute?.(
        { task: 'again' },
        { toolCallId: 'c', messages: [], context: {} },
      ),
  );
  expect(result).toEqual({ text: 'ok' }); // same name 'rec' re-entered, not rejected
});
