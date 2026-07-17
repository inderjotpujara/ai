import { expect, test } from 'bun:test';
import {
  SessionListQuerySchema,
  SessionListResponseSchema,
  SessionRenameRequestSchema,
} from '../../src/contracts/index.ts';

test('SessionListQuerySchema defaults limit to 25 when absent', () => {
  const parsed = SessionListQuerySchema.parse({});
  expect(parsed.limit).toBe(25);
  expect(parsed.search).toBeUndefined();
  expect(parsed.cursor).toBeUndefined();
});

test('SessionListQuerySchema coerces a string limit from a query param', () => {
  const parsed = SessionListQuerySchema.parse({ limit: '10' });
  expect(parsed.limit).toBe(10);
});

test('SessionListQuerySchema rejects a limit above 200', () => {
  expect(() => SessionListQuerySchema.parse({ limit: '500' })).toThrow();
});

test('SessionListQuerySchema rejects a non-positive limit', () => {
  expect(() => SessionListQuerySchema.parse({ limit: '0' })).toThrow();
});

test('SessionListQuerySchema accepts search + cursor', () => {
  const parsed = SessionListQuerySchema.parse({
    search: 'cats',
    cursor: 'b3B0aG9wYXF1ZQ',
  });
  expect(parsed.search).toBe('cats');
  expect(parsed.cursor).toBe('b3B0aG9wYXF1ZQ');
});

test('SessionListResponseSchema round-trips a page with no nextCursor (last page)', () => {
  const parsed = SessionListResponseSchema.parse({
    items: [
      {
        id: 'sess-1',
        title: 'New chat',
        owner: 'local',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    total: 1,
  });
  expect(parsed.items).toHaveLength(1);
  expect(parsed.nextCursor).toBeUndefined();
});

test('SessionListResponseSchema round-trips a page with a nextCursor', () => {
  const parsed = SessionListResponseSchema.parse({
    items: [],
    total: 5,
    nextCursor: 'b3B0aG9wYXF1ZQ',
  });
  expect(parsed.nextCursor).toBe('b3B0aG9wYXF1ZQ');
});

test('SessionRenameRequestSchema accepts a normal title', () => {
  expect(
    SessionRenameRequestSchema.parse({ title: 'My renamed chat' }).title,
  ).toBe('My renamed chat');
});

test('SessionRenameRequestSchema rejects an empty title', () => {
  expect(() => SessionRenameRequestSchema.parse({ title: '' })).toThrow();
});

test('SessionRenameRequestSchema rejects a title over 200 chars', () => {
  expect(() =>
    SessionRenameRequestSchema.parse({ title: 'x'.repeat(201) }),
  ).toThrow();
});
