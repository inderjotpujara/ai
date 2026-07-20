/**
 * Pure, unit-testable webhook verification primitives (Slice 25, Task 19,
 * HARD §7.1). Kept free of any HTTP/Request coupling so the security-critical
 * logic can be exhaustively tested in isolation:
 *   - `hashToken`         — the SHA-256 the DB lookup is keyed by (the raw
 *                           token is hashed once here and NEVER stored/logged).
 *   - `constantTimeEqualHex` — timing-safe compare of two equal-length hex
 *                           digests (reserved for the HMAC signature compare).
 *   - `verifyHmac`        — replay-window check FIRST, then a constant-time
 *                           HMAC-SHA256 compare over the RAW body bytes.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex of the path token — the value `triggers.token_hash` is keyed by.
 *  The raw token is hashed here and never persisted, logged, or returned. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time equality of two hex digests. `timingSafeEqual` THROWS on a
 * length mismatch, so guard the string length first (an immediate non-match),
 * then decode and guard the decoded byte length too — `Buffer.from(hex)`
 * silently drops invalid/odd nibbles, so two equal-length strings can still
 * decode to different byte lengths (a malformed presented signature). Only
 * equal-length byte buffers reach the timing-safe compare.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type VerifyHmacResult = { ok: true } | { ok: false; status: 401 | 409 };

/**
 * Verify an inbound webhook's HMAC signature over the RAW request body.
 *
 * `timestampHeader` is a unix-time value in SECONDS (the GitHub/Stripe
 * `X-…-Timestamp` convention), NOT milliseconds (M4). The REPLAY WINDOW is
 * checked FIRST — before the signature compare — so a stale-but-correctly-signed
 * request is a 409 (replay), never a 401. A non-finite/absent timestamp is 409;
 * a client that mistakenly sends MILLISECONDS (~13 digits) is read as seconds,
 * lands ~thousands of years in the future, falls outside the window → 409.
 *
 * The signature is HMAC-SHA256 over `${timestampHeader}.${rawBody}` (Stripe
 * signs the header value verbatim) against the RAW body bytes exactly as
 * received — never a re-serialized parse — compared constant-time.
 */
export function verifyHmac(opts: {
  rawBody: string;
  secret: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  now: number;
  windowMs: number;
}): VerifyHmacResult {
  const seconds = Number(opts.timestampHeader);
  const tsMs = seconds * 1000;
  // Replay check FIRST (also rejects wrong-unit/garbage/absent timestamps).
  if (!Number.isFinite(seconds) || Math.abs(opts.now - tsMs) > opts.windowMs) {
    return { ok: false, status: 409 };
  }
  if (opts.signatureHeader === null) return { ok: false, status: 401 };
  const expected = createHmac('sha256', opts.secret)
    .update(`${opts.timestampHeader}.${opts.rawBody}`)
    .digest('hex');
  return constantTimeEqualHex(expected, opts.signatureHeader)
    ? { ok: true }
    : { ok: false, status: 401 };
}
