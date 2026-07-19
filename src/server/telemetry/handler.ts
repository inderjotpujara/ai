import { TelemetryEventSchema } from '../../contracts/telemetry.ts';
import { recordVoiceTranscribeWeb } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/** Only the body-token check is needed here — both the legacy `TokenGuard` and
 *  the durable `SessionGuard` (Slice 24 Incr 5) satisfy this shape, so the
 *  beacon path verifies against whichever the server booted with. */
type BeaconTokenVerifier = { verifyToken(raw: string): boolean };

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `POST /api/telemetry` (Slice 30b Phase 8, D10; body-token security
 * fast-follow) — the first client-originated telemetry in the repo. Because
 * `navigator.sendBeacon` can't set an Authorization header AND a `?k=` query
 * token leaks via browser history / proxy access-logs (a real risk once the app
 * is served beyond localhost), the beacon carries `{ token, event }` in its JSON
 * BODY. This route is let past the perimeter's shared header guard, so the
 * handler owns the token check: it verifies the token TIMING-SAFE (via the
 * shared `TokenGuard.verifyToken`) FIRST and 401s on mismatch/missing — no span,
 * no body echo, the token is NEVER logged or spanned. Only after the token
 * passes does it validate `event` against `TelemetryEventSchema` (400 on
 * invalid), write the matching `voice.transcribe.web` span, and ack 204
 * (fire-and-forget: the browser never reads a body).
 */
export async function handleTelemetry(
  req: Request,
  guard: BeaconTokenVerifier,
): Promise<Response> {
  // Parse the body once; a non-JSON body simply yields no token → 401 below.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const token =
    typeof body === 'object' && body !== null
      ? (body as { token?: unknown }).token
      : undefined;
  // TOKEN CHECK FIRST — before touching the event. Never echo/log the token.
  if (typeof token !== 'string' || !guard.verifyToken(token)) {
    return jsonError('unauthorized', 401);
  }
  const eventRaw =
    typeof body === 'object' && body !== null
      ? (body as { event?: unknown }).event
      : undefined;
  let event: ReturnType<typeof TelemetryEventSchema.parse>;
  try {
    event = TelemetryEventSchema.parse(eventRaw);
  } catch {
    return jsonError('invalid telemetry event', 400);
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
