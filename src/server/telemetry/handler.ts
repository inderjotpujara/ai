import { TelemetryEventSchema } from '../../contracts/telemetry.ts';
import { recordVoiceTranscribeWeb } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/**
 * `POST /api/telemetry` (Slice 30b Phase 8, D10) — the first client-originated
 * telemetry in the repo. Validates the `sendBeacon` body against
 * `TelemetryEventSchema`, writes the matching `voice.transcribe.web` span, and
 * acks 204 (fire-and-forget: the browser never reads a body). No `deps` — the
 * span is the only side effect (mirrors `handleFeedback`).
 */
export async function handleTelemetry(req: Request): Promise<Response> {
  let event: ReturnType<typeof TelemetryEventSchema.parse>;
  try {
    event = TelemetryEventSchema.parse(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: 'invalid telemetry event' }), {
      status: 400,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...ISOLATION_HEADERS,
      },
    });
  }
  // Single variant today (§9); switch on `kind` when a second lands.
  // `recordVoiceTranscribeWeb` is only NOMINALLY fire-and-forget: `inSpan`
  // sets ERROR status and RE-THROWS on a span-write failure. A transient OTel
  // hiccup must NOT 500 the beacon endpoint — the client's sendBeacon ignores
  // the response body anyway, so swallow the write error and still ack 204.
  try {
    await recordVoiceTranscribeWeb({
      modelTier: event.modelTier,
      durationMs: event.durationMs,
      wordCount: event.wordCount,
      realTimeFactor: event.realTimeFactor,
      engine: event.engine,
    });
  } catch {
    // Span write failed — intentionally non-fatal for a fire-and-forget beacon.
  }
  return new Response(null, { status: 204, headers: { ...ISOLATION_HEADERS } });
}
