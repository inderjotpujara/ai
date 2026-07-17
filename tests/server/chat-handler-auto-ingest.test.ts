import { expect, test } from 'bun:test';
import { CHAT_MEMORY_SPACE } from '../../src/cli/run-chat-session.ts';
import { ChatRole } from '../../src/contracts/enums.ts';
import type { ChatRequest } from '../../src/contracts/requests.ts';
import type { MemoryStore } from '../../src/memory/store.ts';
import { handleChat } from '../../src/server/chat/handler.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';

const SESSION_ID = crypto.randomUUID();

function chatRequest(body: ChatRequest): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function bodyWithSession(): ChatRequest {
  return {
    messages: [
      {
        id: 'u1',
        role: ChatRole.User,
        parts: [{ type: 'text', text: 'hi there' }],
      },
    ],
    sessionId: SESSION_ID,
  };
}

test('auto-ingest is fired-and-forgotten: rememberOnce is called but never awaited (the stream ends before it resolves)', async () => {
  let rememberCalled = false;
  let rememberResolved = false;
  const fakeMemoryStore = {
    rememberOnce: async () => {
      rememberCalled = true;
      await new Promise((r) => setTimeout(r, 30));
      rememberResolved = true;
      return { skipped: false };
    },
  } as unknown as MemoryStore;
  const runChatTurn: RunChatTurn = async () => ({
    kind: 'answer',
    text: 'the answer',
  });

  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    memoryStore: fakeMemoryStore,
  });
  await res.text(); // the stream fully drains/ends here

  expect(rememberCalled).toBe(true);
  // The key assertion: the stream has already ended, but rememberOnce's own
  // internal 30ms delay hasn't resolved yet — proving handleChat never
  // awaited it (D5/D6, spec §7.1's fire-and-forget requirement).
  expect(rememberResolved).toBe(false);
});

test('calls rememberOnce with the chat space, sessionId namespace, and a per-turn-unique source built from the SAME assistant id T26 persists', async () => {
  const calls: {
    text: string;
    opts: { space: string; namespace?: string; source: string };
  }[] = [];
  const fakeMemoryStore = {
    rememberOnce: async (
      text: string,
      opts: { space: string; namespace?: string; source: string },
    ) => {
      calls.push({ text, opts });
      return { skipped: false };
    },
  } as unknown as MemoryStore;
  const runChatTurn: RunChatTurn = async () => ({
    kind: 'answer',
    text: 'the answer',
  });

  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    memoryStore: fakeMemoryStore,
  });
  await res.text();

  expect(calls).toHaveLength(1);
  expect(calls[0]?.opts.space).toBe(CHAT_MEMORY_SPACE);
  expect(calls[0]?.opts.namespace).toBe(SESSION_ID);
  expect(calls[0]?.opts.source).toMatch(
    new RegExp(`^chat:${SESSION_ID}:asst-`),
  );
  expect(calls[0]?.text).toContain('hi there');
  expect(calls[0]?.text).toContain('the answer');
});

test('a request with no sessionId never touches memoryStore (no namespace to auto-ingest under)', async () => {
  let called = false;
  const fakeMemoryStore = {
    rememberOnce: async () => {
      called = true;
      return { skipped: false };
    },
  } as unknown as MemoryStore;
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const body: ChatRequest = {
    messages: [
      { id: 'u1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] },
    ],
  };
  await (
    await handleChat(chatRequest(body), {
      runChatTurn,
      memoryStore: fakeMemoryStore,
    })
  ).text();
  expect(called).toBe(false);
});

test('a sessionId present but no memoryStore configured degrades gracefully (no crash, no auto-ingest)', async () => {
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const res = await handleChat(chatRequest(bodyWithSession()), { runChatTurn });
  expect(res.status).toBe(200);
  await res.text();
});
