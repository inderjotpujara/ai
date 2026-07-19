import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { SessionTokenStore } from './session-token.ts';

/** Mint a per-session bearer token at launch (256 bits of entropy, hex).
 *  LEGACY per-process token — superseded on the boot path by the durable
 *  root→session guard (`createSessionGuard`, Slice 24 Incr 5). Kept only for
 *  test fixtures that still want a raw constant token. */
export function mintSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Absurd-length bearer/beacon-token cap (carried Fable nit #5). A well-formed
 * session token is a small base64url payload + a 64-char hex sig — a few
 * hundred bytes. Anything past this cap is rejected BEFORE the base64 decode +
 * HMAC in `verifySessionToken` ever runs, so a client can't force expensive
 * crypto with a multi-megabyte "token" (a cheap DoS guard). The full
 * request-body cap is a separate concern (Task 35); this guards the token only.
 */
export const MAX_BEARER_TOKEN_LEN = 8192;

const BEARER_PREFIX = 'Bearer ';

export type TokenGuard = {
  verify(req: Request): boolean;
  verifyToken(raw: string): boolean;
  /** The authorizing principal for a verified request — the reserved
   *  `server.principal` span attribute's source (Slice 24 Incr 3, item 17).
   *  Always `'local'` for this single-token guard (no per-device identity);
   *  the session guard below resolves a real per-device id. */
  principal(req: Request): string;
};

/**
 * The durable per-device guard (Slice 24 Incr 5, D4). Same shape as
 * `TokenGuard` except `principal` resolves the verified token's `deviceId`
 * (`undefined` when the request carries no valid session token) — so a
 * request's authorizing DEVICE, not a constant `'local'`, threads into the
 * `server.request` span (item 17).
 */
export type SessionGuard = {
  verify(req: Request): boolean;
  verifyToken(raw: string): boolean;
  principal(req: Request): string | undefined;
};

/** Constant-time bearer verification against the session token. */
export function createTokenGuard(token: string): TokenGuard {
  const expected = Buffer.from(token);
  const prefix = BEARER_PREFIX;
  // Shared constant-time compare — the ONLY place a candidate is checked
  // against the session token, so both the header bearer and the beacon
  // body-token paths get the same timing-safe treatment (no hand-rolled
  // `===` anywhere).
  const matches = (candidate: string): boolean => {
    const got = Buffer.from(candidate);
    if (got.length !== expected.length) return false;
    return timingSafeEqual(got, expected);
  };
  return {
    verify(req) {
      const header = req.headers.get('authorization');
      if (header === null || !header.startsWith(prefix)) return false;
      return matches(header.slice(prefix.length));
    },
    // `navigator.sendBeacon` cannot set an Authorization header (Slice 30b
    // Phase 8, D10), so the beacon carries the token in its JSON BODY (never
    // the URL — a `?k=` query token leaks via browser history and proxy
    // access-logs once the app is served beyond localhost). The telemetry
    // handler reads the body, extracts the token, and calls this to verify it
    // timing-safe BEFORE parsing the event. Scoped narrowly to that one route.
    verifyToken(raw) {
      return matches(raw);
    },
    principal() {
      return 'local';
    },
  };
}

/**
 * Build the durable per-device guard over a live `SessionTokenStore` (Slice 24
 * Incr 5, D4). This is the SINGLE guard the running server verifies against, so
 * an in-process `revokeDevice`/root `rotate` on that same store takes effect
 * immediately (carried Fable nit #2).
 *
 * Verification is `verifySessionToken` (constant-time, from T33): a
 * valid/unexpired/unrevoked token yields its `deviceId`; anything else → reject.
 * A bearer longer than `MAX_BEARER_TOKEN_LEN` is rejected up front, BEFORE the
 * decode+HMAC (nit #5). The root token itself is NOT a session token, so it can
 * never authenticate a request here — and it never leaves the server.
 */
export function createSessionGuard(
  sessionTokens: SessionTokenStore,
): SessionGuard {
  // Extract the bearer, enforcing the length cap before any crypto touches it.
  const readBearer = (req: Request): string | null => {
    const header = req.headers.get('authorization');
    if (header === null || !header.startsWith(BEARER_PREFIX)) return null;
    const raw = header.slice(BEARER_PREFIX.length);
    if (raw.length > MAX_BEARER_TOKEN_LEN) return null;
    return raw;
  };
  return {
    verify(req) {
      const raw = readBearer(req);
      if (raw === null) return false;
      return sessionTokens.verifySessionToken(raw) !== null;
    },
    // The `navigator.sendBeacon` body-token path (POST /api/telemetry) — same
    // length cap + constant-time session verify as the header path above.
    verifyToken(raw) {
      if (typeof raw !== 'string' || raw.length > MAX_BEARER_TOKEN_LEN) {
        return false;
      }
      return sessionTokens.verifySessionToken(raw) !== null;
    },
    principal(req) {
      const raw = readBearer(req);
      if (raw === null) return undefined;
      return sessionTokens.verifySessionToken(raw)?.deviceId;
    },
  };
}
