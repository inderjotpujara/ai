import { afterEach, beforeEach, expect, test } from 'bun:test';
import { handleFeedback } from '../../src/server/feedback.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

let ctx: ReturnType<typeof registerTestProvider>;

beforeEach(() => {
  ctx = registerTestProvider();
});
afterEach(async () => {
  await ctx.provider.shutdown();
});

function req(body: unknown): Request {
  return new Request('http://localhost/api/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

test('a valid feedback body returns 200 and records a chat.feedback span', async () => {
  const res = await handleFeedback(req({ messageId: 'm1', rating: 'up' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const spans = ctx.exporter.getFinishedSpans();
  const span = spans.find((s) => s.name === 'chat.feedback');
  expect(span).toBeDefined();
  expect(span?.attributes[ATTR.FEEDBACK_MESSAGE_ID]).toBe('m1');
  expect(span?.attributes[ATTR.FEEDBACK_RATING]).toBe('up');
});

test('a missing messageId returns 400', async () => {
  const res = await handleFeedback(req({ rating: 'up' }));
  expect(res.status).toBe(400);
});

test('an invalid rating returns 400', async () => {
  const res = await handleFeedback(
    req({ messageId: 'm1', rating: 'sideways' }),
  );
  expect(res.status).toBe(400);
});

test('a non-JSON body returns 400', async () => {
  const badReq = new Request('http://localhost/api/feedback', {
    method: 'POST',
    body: 'not json',
    headers: { 'content-type': 'application/json' },
  });
  const res = await handleFeedback(badReq);
  expect(res.status).toBe(400);
});
