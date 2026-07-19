import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Mint a per-session bearer token at launch (256 bits of entropy, hex). */
export function mintSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export type TokenGuard = {
  verify(req: Request): boolean;
  verifyToken(raw: string): boolean;
};

/** Constant-time bearer verification against the session token. */
export function createTokenGuard(token: string): TokenGuard {
  const expected = Buffer.from(token);
  const prefix = 'Bearer ';
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
  };
}
