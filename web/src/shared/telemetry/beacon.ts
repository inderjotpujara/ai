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
 * transcription can trigger if the user immediately Sends. The token rides the
 * query string because `sendBeacon` cannot set an Authorization header (the
 * server accepts `?k=` only for this route — see `token.ts` verifyQuery). Never
 * throws: telemetry must never break the voice path.
 */
export function sendTelemetry(event: TelemetryEvent): void {
  try {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.sendBeacon !== 'function'
    )
      return;
    const url = `/api/telemetry?k=${encodeURIComponent(tokenFromWindow())}`;
    const blob = new Blob([JSON.stringify(event)], {
      type: 'application/json',
    });
    navigator.sendBeacon(url, blob);
  } catch {
    // swallow — fire-and-forget
  }
}
