import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { runChat } from '../../src/cli/run-chat.ts';
import type { Agent } from '../../src/core/agent-def.ts';
import { createOrchestrator } from '../../src/core/orchestrator.ts';
import { createRun } from '../../src/run/run-store.ts';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
import { withRunContext } from '../../src/telemetry/run-router.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chat-stream-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A streaming mock model that yields "Hel" + "lo" as text deltas, then finishes. */
function streamingAnswerOrchestrator(): Agent {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: '0' },
          { type: 'text-delta', id: '0', delta: 'Hel' },
          { type: 'text-delta', id: '0', delta: 'lo' },
          { type: 'text-end', id: '0' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: undefined,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: 2,
                text: undefined,
                reasoning: undefined,
              },
            },
          },
        ],
      }),
    }),
  });
  return createOrchestrator({ model, systemPrompt: 'route', agents: [] });
}

test('runChat forwards deps.stream to the orchestrator so the answer streams, and still writes answer.txt', async () => {
  const run = await createRun(root, 'run-stream');
  const tel = initRunTelemetry(run.dir, run.id);
  const sink = mock((_uiStream: ReadableStream) => {});
  let result: Awaited<ReturnType<typeof runChat>>;
  try {
    result = await withRunContext(run.id, () =>
      runChat({
        orchestrator: streamingAnswerOrchestrator(),
        task: 'say hello',
        run,
        stream: sink,
      }),
    );
  } finally {
    await tel.shutdown();
  }

  expect(sink).toHaveBeenCalledTimes(1);
  expect(sink.mock.calls[0]?.[0]).toBeInstanceOf(ReadableStream);
  expect(result.kind).toBe('answer');
  if (result.kind === 'answer') {
    expect(result.text).toBe('Hello');
  }
  expect(await readFile(join(root, 'run-stream', 'answer.txt'), 'utf8')).toBe(
    'Hello',
  );
});
