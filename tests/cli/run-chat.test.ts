import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { runChat } from '../../src/cli/run-chat.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import { createOrchestrator } from '../../src/core/orchestrator.ts';
import { createRun } from '../../src/run/run-store.ts';
import { readSpans } from '../../src/run/run-trace.ts';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
import { withRunContext } from '../../src/telemetry/run-router.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chat-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function gapOrchestrator(): Agent {
  // orchestrator model that calls report_capability_gap on turn 1
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
              toolName: 'report_capability_gap',
              input: JSON.stringify({ missingCapability: 'send email' }),
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
        content: [{ type: 'text', text: '' }],
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
  return createOrchestrator({ model, systemPrompt: 'route', agents: [] });
}

test('runChat records a gap run and writes the gap artifact', async () => {
  const run = await createRun(root, 'run-1');
  const tel = initRunTelemetry(run.dir, run.id);
  let result: Awaited<ReturnType<typeof runChat>>;
  try {
    result = await withRunContext(run.id, () =>
      runChat({
        orchestrator: gapOrchestrator(),
        task: 'email my boss',
        run,
      }),
    );
  } finally {
    await tel.shutdown();
  }
  expect(result.kind).toBe('gap');
  expect(await readFile(join(root, 'run-1', 'gap.txt'), 'utf8')).toContain(
    'send email',
  );
});

function answerOrchestrator(): Agent {
  // orchestrator model that produces final text directly (no tool calls)
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Here is your answer.' }],
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
  return createOrchestrator({ model, systemPrompt: 'route', agents: [] });
}

test('runChat records an answer run and writes the answer artifact', async () => {
  const run = await createRun(root, 'run-2');
  const tel = initRunTelemetry(run.dir, run.id);
  let result: Awaited<ReturnType<typeof runChat>>;
  try {
    result = await withRunContext(run.id, () =>
      runChat({
        orchestrator: answerOrchestrator(),
        task: 'what is 2+2?',
        run,
      }),
    );
  } finally {
    await tel.shutdown();
  }
  expect(result.kind).toBe('answer');
  if (result.kind === 'answer') {
    expect(result.text).toBe('Here is your answer.');
  }
  expect(await readFile(join(root, 'run-2', 'answer.txt'), 'utf8')).toBe(
    'Here is your answer.',
  );
});

test('runChat writes spans.jsonl with a root run span carrying the outcome', async () => {
  const run = await createRun(root, 'run-span');
  const tel = initRunTelemetry(run.dir, run.id);
  let result: Awaited<ReturnType<typeof runChat>>;
  try {
    result = await withRunContext(run.id, () =>
      runChat({
        orchestrator: gapOrchestrator(),
        task: 'email my boss',
        run,
      }),
    );
  } finally {
    await tel.shutdown();
  }
  expect(result.kind).toBe('gap');
  const { spans } = await readSpans(join(root, 'run-span'));
  const runSpan = spans.find((s) => s.name === 'agent.run');
  expect(runSpan).toBeDefined();
  expect(runSpan?.attributes['agent.outcome']).toBe('gap');
});

test('runChat threads deps.signal down to the orchestrator model call', async () => {
  const run = await createRun(root, 'run-signal');
  const tel = initRunTelemetry(run.dir, run.id);
  let seenAborted: boolean | undefined;
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => {
      seenAborted = abortSignal?.aborted;
      if (abortSignal?.aborted) {
        throw new Error('aborted before generation');
      }
      return {
        content: [{ type: 'text', text: 'unreachable' }],
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
  const orchestrator = createOrchestrator({
    model,
    systemPrompt: 'route',
    agents: [],
  });
  try {
    await expect(
      withRunContext(run.id, () =>
        runChat({
          orchestrator,
          task: 'x',
          run,
          signal: AbortSignal.abort(),
        }),
      ),
    ).rejects.toThrow();
  } finally {
    await tel.shutdown();
  }
  expect(seenAborted).toBe(true);
});

test('runChat no longer writes journal.jsonl', async () => {
  const run = await createRun(root, 'run-nojournal');
  const tel = initRunTelemetry(run.dir, run.id);
  try {
    await withRunContext(run.id, () =>
      runChat({
        orchestrator: gapOrchestrator(),
        task: 'x',
        run,
      }),
    );
  } finally {
    await tel.shutdown();
  }
  await expect(
    stat(join(root, 'run-nojournal', 'journal.jsonl')),
  ).rejects.toThrow();
});
