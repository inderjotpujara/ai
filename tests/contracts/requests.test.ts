import { expect, test } from 'bun:test';
import { ChatRole } from '../../src/contracts/enums.ts';
import {
  ChatRequestSchema,
  RespondRequestSchema,
  UiMessageLikeSchema,
} from '../../src/contracts/requests.ts';

test('a minimal UIMessage-like body validates (no AI-SDK types)', () => {
  const parsed = UiMessageLikeSchema.parse({
    id: 'm1',
    role: ChatRole.User,
    parts: [{ type: 'text', text: 'hello' }],
  });
  expect(parsed.parts[0]?.text).toBe('hello');
});

test('ChatRequest validates a messages array + optional sessionId', () => {
  const parsed = ChatRequestSchema.parse({
    messages: [{ id: 'm1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] }],
  });
  expect(parsed.messages.length).toBe(1);
  expect(parsed.sessionId).toBeUndefined();
});

test('ChatRequest rejects a malformed body (missing messages)', () => {
  expect(() => ChatRequestSchema.parse({ foo: 1 })).toThrow();
});

test('RespondRequest requires a promptId and accepts an opaque value', () => {
  const parsed = RespondRequestSchema.parse({ promptId: 'cap-x', value: { ok: true } });
  expect(parsed.promptId).toBe('cap-x');
  expect(() => RespondRequestSchema.parse({ value: 1 })).toThrow();
});
