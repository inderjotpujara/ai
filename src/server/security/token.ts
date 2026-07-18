import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Mint a per-session bearer token at launch (256 bits of entropy, hex). */
export function mintSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export type TokenGuard = {
  verify(req: Request): boolean;
  verifyQuery(url: URL): boolean;
};

/** Constant-time bearer verification against the session token. */
export function createTokenGuard(token: string): TokenGuard {
  const expected = Buffer.from(token);
  const prefix = 'Bearer ';
  // Shared constant-time compare — the ONLY place a candidate is checked
  // against the session token, so both the header and query paths get the
  // same timing-safe treatment (no hand-rolled `===` anywhere).
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
    // Phase 8, D10). `buildFetch` calls this ONLY for POST /api/telemetry —
    // same-origin, already behind the Host/Origin perimeter, and the token is
    // already same-origin-readable via `window.__AGENT_TOKEN__`, so it adds no
    // material attack surface. Scoped narrowly on purpose.
    verifyQuery(url) {
      const k = url.searchParams.get('k');
      return k !== null && matches(k);
    },
  };
}
