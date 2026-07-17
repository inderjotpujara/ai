import { expect, test } from 'bun:test';
import {
  ChatRole,
  DegradeKind,
  StatusEventType,
} from '../../src/contracts/enums.ts';
import type { ChatRequest } from '../../src/contracts/requests.ts';
import { handleChat } from '../../src/server/chat/handler.ts';
import type { RunChatTurn } from '../../src/server/chat/run-turn.ts';
import type { SessionStore } from '../../src/session/store.ts';

const SESSION_ID = crypto.randomUUID();

type RecordedMessage = {
  sessionId: string;
  id: string;
  role: string;
  parts: unknown;
  degraded?: boolean;
  runId?: string;
};

function fakeSessionStore(): {
  store: SessionStore;
  calls: string[];
  sessions: Map<string, { title: string }>;
  messages: RecordedMessage[];
} {
  const calls: string[] = [];
  const sessions = new Map<string, { title: string }>();
  const messages: RecordedMessage[] = [];
  const store = {
    upsertSession: (id: string, opts: { defaultTitle: string; at: number }) => {
      calls.push('upsertSession');
      if (!sessions.has(id)) sessions.set(id, { title: opts.defaultTitle });
    },
    getSession: () => undefined,
    renameSession: () => {},
    deleteSession: () => {},
    listSessions: () => ({ items: [], total: 0 }),
    appendMessage: (
      sessionId: string,
      msg: {
        id: string;
        role: string;
        parts: unknown;
        degraded?: boolean;
        runId?: string;
      },
    ) => {
      calls.push(`appendMessage:${msg.role}`);
      messages.push({ sessionId, ...msg });
    },
    getMessages: () => [],
    close: () => {},
  } as unknown as SessionStore;
  return { store, calls, sessions, messages };
}

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

test('§7.1(a): persists the user message BEFORE runChatTurn is invoked', async () => {
  const { store, calls } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => {
    calls.push('runChatTurn');
    return { kind: 'answer', text: 'hi' };
  };
  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    sessionStore: store,
  });
  await res.text(); // drain the SSE body so execute() has fully settled
  expect(calls.indexOf('upsertSession')).toBeLessThan(
    calls.indexOf('runChatTurn'),
  );
  expect(calls.indexOf('appendMessage:user')).toBeLessThan(
    calls.indexOf('runChatTurn'),
  );
});

test('persists the assistant answer AFTER runChatTurn resolves, tagged with degraded + the captured runId (D7)', async () => {
  const { store, messages } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async (input) => {
    input.events({
      type: StatusEventType.RunStart,
      runId: 'run-abc',
      task: input.task,
    });
    input.events({
      type: StatusEventType.Degrade,
      kind: DegradeKind.ModelDegraded,
      subject: 'router',
      reason: 'fallback model used',
    });
    return { kind: 'answer', text: 'the answer' };
  };
  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    sessionStore: store,
  });
  await res.text();

  const assistantRow = messages.find((m) => m.role === ChatRole.Assistant);
  expect(assistantRow).toBeDefined();
  expect(assistantRow?.sessionId).toBe(SESSION_ID);
  expect((assistantRow?.parts as { text: string }[])[0]?.text).toBe(
    'the answer',
  );
  expect(assistantRow?.degraded).toBe(true);
  expect(assistantRow?.runId).toBe('run-abc');
});

test('a "gap" outcome persists result.message as the assistant text (not an empty string)', async () => {
  const { store, messages } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => ({
    kind: 'gap',
    missingCapability: 'video-editing',
    message: "I don't have a capability to handle this yet: video-editing.",
  });
  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    sessionStore: store,
  });
  await res.text();

  const assistantRow = messages.find((m) => m.role === ChatRole.Assistant);
  expect((assistantRow?.parts as { text: string }[])[0]?.text).toBe(
    "I don't have a capability to handle this yet: video-editing.",
  );
  expect(assistantRow?.degraded).toBe(false);
});

test('§7.1(b)/(e): a thrown turn leaves the user row present but writes NO assistant row (deliberate gap, never partial)', async () => {
  const { store, messages, calls } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => {
    throw new Error('boom');
  };
  const res = await handleChat(chatRequest(bodyWithSession()), {
    runChatTurn,
    sessionStore: store,
  });
  // createUIMessageStream's onError converts the throw into an SSE error
  // chunk rather than rejecting handleChat itself (existing behavior).
  await res.text();

  expect(calls).toContain('appendMessage:user');
  expect(messages.some((m) => m.role === ChatRole.Assistant)).toBe(false);
});

test('§7.1(c): a repeat sessionId across two requests upserts once — title from the FIRST request wins', async () => {
  const { store, sessions } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const firstBody: ChatRequest = {
    messages: [
      {
        id: 'u1',
        role: ChatRole.User,
        parts: [{ type: 'text', text: 'first question' }],
      },
    ],
    sessionId: SESSION_ID,
  };
  const secondBody: ChatRequest = {
    messages: [
      {
        id: 'u2',
        role: ChatRole.User,
        parts: [{ type: 'text', text: 'second question' }],
      },
    ],
    sessionId: SESSION_ID,
  };
  await (
    await handleChat(chatRequest(firstBody), {
      runChatTurn,
      sessionStore: store,
    })
  ).text();
  await (
    await handleChat(chatRequest(secondBody), {
      runChatTurn,
      sessionStore: store,
    })
  ).text();

  expect(sessions.size).toBe(1);
  expect(sessions.get(SESSION_ID)?.title).toBe('first question');
});

test('a request with no sessionId never touches the session store', async () => {
  const { store, calls } = fakeSessionStore();
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const body: ChatRequest = {
    messages: [
      { id: 'u1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] },
    ],
  };
  await (
    await handleChat(chatRequest(body), { runChatTurn, sessionStore: store })
  ).text();
  expect(calls).toEqual([]);
});

test('a sessionId present but NO sessionStore configured degrades gracefully (no crash, no persistence)', async () => {
  const runChatTurn: RunChatTurn = async () => ({ kind: 'answer', text: 'ok' });
  const res = await handleChat(chatRequest(bodyWithSession()), { runChatTurn });
  expect(res.status).toBe(200);
  await res.text();
});
