import { expect, test } from 'bun:test';
import { ChatRole, StatusEventType } from '../../src/contracts/enums.ts';
import type { ChatRequest } from '../../src/contracts/requests.ts';
import { handleChat } from '../../src/server/chat/handler.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

function textChunkStream(text: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'text-start', id: 't1' });
      controller.enqueue({ type: 'text-delta', id: 't1', delta: text });
      controller.enqueue({ type: 'text-end', id: 't1' });
      controller.close();
    },
  });
}

function chatRequest(body: ChatRequest): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody: ChatRequest = {
  messages: [
    {
      id: '1',
      role: ChatRole.User,
      parts: [{ type: 'text', text: 'hi there' }],
    },
  ],
};

test('streams a text/event-stream response carrying COOP/COEP + no-store', async () => {
  const fakeRunChatTurn: RunChatTurn = async (input) => {
    input.events({
      type: StatusEventType.Delegation,
      agent: 'file_qa',
      depth: 1,
      ancestors: ['orchestrator'],
    });
    input.stream(textChunkStream('hi'));
    return { kind: 'answer', text: 'hi' };
  };

  const res = await handleChat(chatRequest(validBody), {
    runChatTurn: fakeRunChatTurn,
  });

  expect(res.headers.get('content-type')).toContain('text/event-stream');
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  expect(res.headers.get('cache-control')).toBe('no-store');

  const body = await res.text();
  expect(body).toContain('data-delegation');
  expect(body).toContain('"agent":"file_qa"');
  expect(body).toContain('hi');
});

test('the ui.stream span records the real outcome + chunk count after the awaited turn (regression: span must wrap the work INSIDE execute)', async () => {
  const { exporter, provider } = registerTestProvider();
  // A turn with a REAL await before it resolves — this is what exposes the
  // outer-wrap bug: with the span wrapping the outer body, its `finally`
  // fires before this await settles and records {chunks:0, outcome:'unknown'}.
  const slowRunChatTurn: RunChatTurn = async (input) => {
    await new Promise((r) => setTimeout(r, 5));
    input.events({
      type: StatusEventType.Delegation,
      agent: 'file_qa',
      depth: 1,
      ancestors: ['orchestrator'],
    });
    return { kind: 'answer', text: 'hi' };
  };

  const res = await handleChat(chatRequest(validBody), {
    runChatTurn: slowRunChatTurn,
  });
  // Fully drain the SSE body so `execute` (and thus the span) has completed.
  await res.text();

  const span = exporter.getFinishedSpans().find((s) => s.name === 'ui.stream');
  expect(span).toBeDefined();
  expect(span?.attributes[ATTR.UI_STREAM_OUTCOME]).toBe('answer');
  expect(
    Number(span?.attributes[ATTR.UI_STREAM_CHUNKS]),
  ).toBeGreaterThanOrEqual(1);
  await provider.shutdown();
});

test('renders a "gap" outcome message on the stream (regression: the orchestrator synthesizes result.message AFTER generation — nothing streams it otherwise, so the browser shows an empty bubble)', async () => {
  const gapRunChatTurn: RunChatTurn = async () => ({
    kind: 'gap',
    missingCapability: 'video-editing',
    message: "I don't have a capability to handle this yet: video-editing.",
  });

  const res = await handleChat(chatRequest(validBody), {
    runChatTurn: gapRunChatTurn,
  });

  const body = await res.text();
  expect(body).toContain(
    "I don't have a capability to handle this yet: video-editing.",
  );
});

test('renders a "resource" outcome message on the stream', async () => {
  const resourceRunChatTurn: RunChatTurn = async () => ({
    kind: 'resource',
    message: 'model failed to load: out of memory',
  });

  const res = await handleChat(chatRequest(validBody), {
    runChatTurn: resourceRunChatTurn,
  });

  const body = await res.text();
  expect(body).toContain('model failed to load: out of memory');
});

test('rejects a malformed body (missing messages) with 400', async () => {
  const res = await handleChat(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
    {
      runChatTurn: (async () => ({ kind: 'answer', text: '' })) as RunChatTurn,
    },
  );
  expect(res.status).toBe(400);
});

test('rejects non-JSON body with 400', async () => {
  const res = await handleChat(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }),
    {
      runChatTurn: (async () => ({ kind: 'answer', text: '' })) as RunChatTurn,
    },
  );
  expect(res.status).toBe(400);
});
