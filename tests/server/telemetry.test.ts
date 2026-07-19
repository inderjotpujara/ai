import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createTokenGuard } from '../../src/server/security/token.ts';
import { handleTelemetry } from '../../src/server/telemetry/handler.ts';
import * as spans from '../../src/telemetry/spans.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

const TOKEN = 'a'.repeat(64);
const guard = createTokenGuard(TOKEN);

let ctx: ReturnType<typeof registerTestProvider>;
beforeEach(() => {
  ctx = registerTestProvider();
});
afterEach(async () => {
  await ctx.provider.shutdown();
});

/** The beacon body: `{ token, event }` (token in BODY, never the URL). */
function req(body: unknown, token: string = TOKEN): Request {
  return new Request('http://localhost/api/telemetry', {
    method: 'POST',
    body: JSON.stringify({ token, event: body }),
    headers: { 'content-type': 'application/json' },
  });
}

const valid = {
  kind: 'voice.transcribe.web',
  durationMs: 1500,
  wordCount: 12,
  modelTier: 'moonshine-tiny',
  realTimeFactor: 0.6,
  engine: 'transformers.js',
};

test('a valid token+event returns 204 and writes a voice.transcribe.web span with the posted attrs', async () => {
  const res = await handleTelemetry(req(valid), guard);
  expect(res.status).toBe(204);
  const span = ctx.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'voice.transcribe.web');
  expect(span?.attributes[ATTR.VOICE_STT_MODEL]).toBe('moonshine-tiny');
  expect(span?.attributes[ATTR.VOICE_WORD_COUNT]).toBe(12);
  expect(span?.attributes[ATTR.VOICE_REAL_TIME_FACTOR]).toBe(0.6);
});

test('a wrong token returns 401 and writes no span (token checked before the event)', async () => {
  const res = await handleTelemetry(req(valid, 'b'.repeat(64)), guard);
  expect(res.status).toBe(401);
  expect(
    ctx.exporter
      .getFinishedSpans()
      .find((s) => s.name === 'voice.transcribe.web'),
  ).toBeUndefined();
});

test('a missing token returns 401 and writes no span', async () => {
  const bare = new Request('http://localhost/api/telemetry', {
    method: 'POST',
    body: JSON.stringify({ event: valid }),
    headers: { 'content-type': 'application/json' },
  });
  const res = await handleTelemetry(bare, guard);
  expect(res.status).toBe(401);
  expect(
    ctx.exporter
      .getFinishedSpans()
      .find((s) => s.name === 'voice.transcribe.web'),
  ).toBeUndefined();
});

test('a valid token but invalid event returns 400 and writes no span', async () => {
  const res = await handleTelemetry(
    req({ kind: 'voice.transcribe.web' }),
    guard,
  );
  expect(res.status).toBe(400);
  expect(
    ctx.exporter
      .getFinishedSpans()
      .find((s) => s.name === 'voice.transcribe.web'),
  ).toBeUndefined();
});

test('a non-JSON body yields no token → 401', async () => {
  const bad = new Request('http://localhost/api/telemetry', {
    method: 'POST',
    body: 'not json',
    headers: { 'content-type': 'application/json' },
  });
  expect((await handleTelemetry(bad, guard)).status).toBe(401);
});

test('a span-write failure still acks 204 (telemetry hiccup must not 500 the beacon)', async () => {
  // `recordVoiceTranscribeWeb` is only NOMINALLY fire-and-forget: `inSpan`
  // sets ERROR status and RE-THROWS on failure. A transient OTel write error
  // must NOT surface as a 500 — the client's sendBeacon ignores the body, so
  // the endpoint must still ack. Force the throw and assert the ack holds.
  const spy = spyOn(spans, 'recordVoiceTranscribeWeb').mockRejectedValue(
    new Error('span export exploded'),
  );
  try {
    const res = await handleTelemetry(req(valid), guard);
    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});
