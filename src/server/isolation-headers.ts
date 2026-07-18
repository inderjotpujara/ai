/**
 * COOP/COEP so the frontend can use transformers.js's threaded WASM backend
 * (SharedArrayBuffer) for browser STT/VAD inference (Slice 30b Phase 7).
 * Originally put in place for a sherpa-onnx WASM plan the phase later
 * rejected (see docs/architecture.md's Voice section, D1) — the isolation
 * requirement carried over unchanged to transformers.js.
 * Lives in its own module (not `app.ts`) so route handlers under
 * `src/server/chat/**` can import it without a circular dependency on `app.ts`
 * (which imports those handlers to register routes).
 */
export const ISOLATION_HEADERS: Record<string, string> = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};
