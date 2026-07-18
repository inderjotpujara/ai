import { expect, test } from 'bun:test';
import { ChatRole } from '../../src/contracts/enums.ts';
import { ChatRequestSchema } from '../../src/contracts/requests.ts';

const messages = [
  { id: 'm1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] },
];

test('accepts a real crypto.randomUUID() v4 sessionId', () => {
  const id = crypto.randomUUID();
  const parsed = ChatRequestSchema.parse({ messages, sessionId: id });
  expect(parsed.sessionId).toBe(id);
});

test('accepts a request with no sessionId at all (still optional)', () => {
  const parsed = ChatRequestSchema.parse({ messages });
  expect(parsed.sessionId).toBeUndefined();
});

test('rejects a non-UUID sessionId', () => {
  expect(() =>
    ChatRequestSchema.parse({ messages, sessionId: 'not-a-uuid' }),
  ).toThrow();
});

test('rejects a UUID of the wrong version (v1, not v4)', () => {
  // v1 UUID shape: version nibble '1' instead of '4'.
  expect(() =>
    ChatRequestSchema.parse({
      messages,
      sessionId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    }),
  ).toThrow();
});

test('rejects an empty-string sessionId', () => {
  expect(() => ChatRequestSchema.parse({ messages, sessionId: '' })).toThrow();
});
