/**
 * COOP/COEP so the frontend can later use sherpa WASM SharedArrayBuffer.
 * Lives in its own module (not `app.ts`) so route handlers under
 * `src/server/chat/**` can import it without a circular dependency on `app.ts`
 * (which imports those handlers to register routes).
 */
export const ISOLATION_HEADERS: Record<string, string> = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};
