import { expect, mock, test } from 'bun:test';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { runAgent } from '../../src/core/agent.ts';

/** A streaming mock model that yields "Hel" + "lo" as text deltas, then finishes. */
function streamingHelloModel() {
  return new MockLanguageModelV3({
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
              outputTokens: { total: 2, text: undefined, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

test('runAgent with a stream sink uses streamText, invokes the sink once with a ReadableStream, and resolves the full text', async () => {
  const model = streamingHelloModel();
  const sink = mock((_uiStream: ReadableStream) => {});

  const { text } = await runAgent({
    model,
    systemPrompt: 'You are a test agent.',
    prompt: 'Say hello.',
    tools: {},
    stream: sink,
  });

  expect(text).toBe('Hello');
  expect(sink).toHaveBeenCalledTimes(1);
  expect(sink.mock.calls[0]?.[0]).toBeInstanceOf(ReadableStream);
});
