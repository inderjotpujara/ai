import type { TelemetryEvent } from '@contracts';

/** The BFF injects window.__AGENT_TOKEN__ (empty in Vite dev) — same source as
 *  shared/contract/client.ts. */
function tokenFromWindow(): string {
  const w = globalThis as { window?: { __AGENT_TOKEN__?: string } };
  return w.window?.__AGENT_TOKEN__ ?? '';
}

/**
 * Fire-and-forget client telemetry (Slice 30b Phase 8, D10) — the first
 * client-originated telemetry in the repo. `navigator.sendBeacon` is the one
 * delivery that survives a page unload/navigation, which a completed voice
 * transcription can trigger if the user immediately Sends. `sendBeacon` cannot
 * set an Authorization header, so the token travels in the request BODY
 * (`{ token, event }`) — NOT the URL: a `?k=` query token leaks via browser
 * history and proxy access-logs once the app is served beyond localhost. The
 * server handler self-authenticates the body token timing-safe before writing
 * the span (see `token.ts`/`telemetry/handler.ts`). Never throws: telemetry
 * must never break the voice path.
 */
export function sendTelemetry(event: TelemetryEvent): void {
  try {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.sendBeacon !== 'function'
    )
      return;
    const blob = new Blob(
      [JSON.stringify({ token: tokenFromWindow(), event })],
      {
        type: 'application/json',
      },
    );
    navigator.sendBeacon('/api/telemetry', blob);
  } catch {
    // swallow — fire-and-forget
  }
}
