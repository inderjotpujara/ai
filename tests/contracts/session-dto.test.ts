import { expect, test } from 'bun:test';
import { ChatRole } from '../../src/contracts/enums.ts';
import {
  SessionDtoSchema,
  SessionListItemDtoSchema,
} from '../../src/contracts/index.ts';

test('SessionListItemDtoSchema round-trips a minimal session summary (no optional fields)', () => {
  const parsed = SessionListItemDtoSchema.parse({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 1_000,
  });
  expect(parsed).toEqual({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 1_000,
  });
  expect(parsed.lastMessageAt).toBeUndefined();
  expect(parsed.runId).toBeUndefined();
});

test('SessionListItemDtoSchema accepts lastMessageAt/runId when present', () => {
  const parsed = SessionListItemDtoSchema.parse({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 2_000,
    lastMessageAt: 2_000,
    runId: 'run-abc',
  });
  expect(parsed.lastMessageAt).toBe(2_000);
  expect(parsed.runId).toBe('run-abc');
});

test('SessionListItemDtoSchema rejects a payload missing a required field', () => {
  expect(() => SessionListItemDtoSchema.parse({ title: 'New chat' })).toThrow();
});

test('SessionDtoSchema embeds ChatMessageDTO[] verbatim (spec D8)', () => {
  const parsed = SessionDtoSchema.parse({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 1_000,
    messages: [
      { id: 'm1', role: ChatRole.User, text: 'hello' },
      { id: 'm2', role: ChatRole.Assistant, text: 'hi there', degraded: true },
    ],
  });
  expect(parsed.messages).toHaveLength(2);
  expect(parsed.messages[0]?.role).toBe(ChatRole.User);
  expect(parsed.messages[1]?.degraded).toBe(true);
});

test('SessionDtoSchema accepts an empty transcript (a brand-new session)', () => {
  const parsed = SessionDtoSchema.parse({
    id: 'sess-1',
    title: 'New chat',
    owner: 'local',
    createdAt: 1_000,
    updatedAt: 1_000,
    messages: [],
  });
  expect(parsed.messages).toEqual([]);
});
