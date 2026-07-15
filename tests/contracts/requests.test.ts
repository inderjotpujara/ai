import { expect, test } from 'bun:test';
import {
  ChatRole,
  FeedbackRating,
  RunLifecycle,
  RunOrigin,
} from '../../src/contracts/enums.ts';
import {
  ChatRequestSchema,
  FeedbackRequestSchema,
  RespondRequestSchema,
  RunListQuerySchema,
  RunListResponseSchema,
  UiMessageLikeSchema,
  UploadResponseSchema,
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
    messages: [
      { id: 'm1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] },
    ],
  });
  expect(parsed.messages.length).toBe(1);
  expect(parsed.sessionId).toBeUndefined();
});

test('ChatRequest rejects a malformed body (missing messages)', () => {
  expect(() => ChatRequestSchema.parse({ foo: 1 })).toThrow();
});

test('ChatRequest accepts an optional uploadIds array (media-by-reference, Task 16)', () => {
  const parsed = ChatRequestSchema.parse({
    messages: [
      { id: 'm1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] },
    ],
    uploadIds: ['a1b2c3.png'],
  });
  expect(parsed.uploadIds).toEqual(['a1b2c3.png']);
});

test('ChatRequest still validates with uploadIds omitted', () => {
  const parsed = ChatRequestSchema.parse({
    messages: [
      { id: 'm1', role: ChatRole.User, parts: [{ type: 'text', text: 'hi' }] },
    ],
  });
  expect(parsed.uploadIds).toBeUndefined();
});

test('UploadResponse round-trips a server-minted uploadId', () => {
  const parsed = UploadResponseSchema.parse({ uploadId: 'deadbeef.png' });
  expect(parsed.uploadId).toBe('deadbeef.png');
});

test('UploadResponse rejects a missing uploadId', () => {
  const result = UploadResponseSchema.safeParse({});
  expect(result.success).toBe(false);
});

test('RespondRequest requires a promptId and accepts an opaque value', () => {
  const parsed = RespondRequestSchema.parse({
    promptId: 'cap-x',
    value: { ok: true },
  });
  expect(parsed.promptId).toBe('cap-x');
  expect(() => RespondRequestSchema.parse({ value: 1 })).toThrow();
});

test('FeedbackRequest validates a messageId + rating', () => {
  const parsed = FeedbackRequestSchema.parse({
    messageId: 'm1',
    rating: FeedbackRating.Up,
  });
  expect(parsed.messageId).toBe('m1');
  expect(parsed.rating).toBe(FeedbackRating.Up);
});

test('FeedbackRequest rejects an invalid rating enum value', () => {
  const result = FeedbackRequestSchema.safeParse({
    messageId: 'm1',
    rating: 'sideways',
  });
  expect(result.success).toBe(false);
});

test('FeedbackRequest rejects a missing messageId', () => {
  const result = FeedbackRequestSchema.safeParse({ rating: 'up' });
  expect(result.success).toBe(false);
});

test('RunListQuery coerces string query params and defaults limit', () => {
  const parsed = RunListQuerySchema.parse({
    search: 'qwen',
    outcome: 'answer',
    degraded: 'true',
    limit: '10',
  });
  expect(parsed).toEqual({
    search: 'qwen',
    outcome: 'answer',
    degraded: true,
    limit: 10,
  });
});

test('RunListQuery applies the default limit when omitted', () => {
  const parsed = RunListQuerySchema.parse({});
  expect(parsed.limit).toBe(25);
  expect(parsed.degraded).toBeUndefined();
});

test('RunListResponse validates items + pagination', () => {
  const parsed = RunListResponseSchema.parse({
    items: [
      {
        id: 'run-1',
        startMs: 1,
        durationMs: 2,
        outcome: 'answer',
        lifecycle: RunLifecycle.Done,
        origin: RunOrigin.Manual,
        models: [],
        degraded: false,
        spanCount: 1,
      },
    ],
    nextCursor: 'abc',
    total: 1,
  });
  expect(parsed.items).toHaveLength(1);
  expect(parsed.nextCursor).toBe('abc');
});
