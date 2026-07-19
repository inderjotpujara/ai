/**
 * Per-device session-token store for the always-on local agent daemon
 * (Slice 24 Increment 5, §7.4).
 *
 * A session token is what a browser or remote device actually holds — NEVER the
 * root (`root-token.ts`). Each token is a stateless, HMAC-signed grant:
 *
 *     payload = base64url({ deviceId, exp })
 *     sig     = HMAC-SHA256(rootToken, payload)
 *     token   = `${payload}.${sig}`
 *
 * Because the signature is keyed by the root token, no server-side session
 * database is needed to verify one, and rotating the root (`root-token.ts`)
 * invalidates EVERY outstanding session at once — their sigs no longer verify
 * against the new key. The only server-side state is a small persisted
 * revocation set (`0600` JSON), which lets a single device be revoked WITHOUT
 * rotating the root (so the other devices keep working).
 *
 * `verifySessionToken` is constant-time: the signature compare reuses the same
 * `timingSafeEqual`-with-length-guard pattern as `token.ts` (return `null` on a
 * length mismatch, never throw, never a content-dependent `===` short-circuit).
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SessionPrincipal = { deviceId: string };

export type SessionTokenStore = {
  mintSessionToken(args: { deviceId: string; ttlMs: number }): string;
  verifySessionToken(raw: string): SessionPrincipal | null;
  revokeDevice(deviceId: string): void;
};

type Payload = { deviceId: string; exp: number };

/** HMAC-SHA256 of `payload` keyed by the root token, hex-encoded. */
function sign(rootToken: string, payload: string): string {
  return createHmac('sha256', rootToken).update(payload).digest('hex');
}

/**
 * Constant-time signature compare — the SAME timing-safe pattern `token.ts`
 * uses (`timingSafeEqual` on equal-length buffers, with a length guard so a
 * mismatched length returns `false` instead of throwing). No hand-rolled `===`
 * on secret material anywhere.
 */
function sigMatches(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createSessionTokenStore(config: {
  path: string;
  rootToken: string;
}): SessionTokenStore {
  const { path, rootToken } = config;

  // Revocation set persisted at construction — survives restarts. An ABSENT
  // file is fine (nothing revoked yet, e.g. first boot) and collapses to an
  // empty set. A PRESENT-but-corrupt/unparseable file is a security-relevant
  // failure — silently treating it as "nothing revoked" would un-revoke every
  // device — so `loadRevoked` throws instead (fail CLOSED at construction: the
  // daemon refuses to start rather than serve verifies against a broken store).
  const revoked = new Set<string>(loadRevoked(path));

  function persistRevoked(): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify([...revoked]), { mode: 0o600 });
  }

  return {
    mintSessionToken({ deviceId, ttlMs }): string {
      const payloadObj: Payload = { deviceId, exp: Date.now() + ttlMs };
      const payload = Buffer.from(JSON.stringify(payloadObj)).toString(
        'base64url',
      );
      return `${payload}.${sign(rootToken, payload)}`;
    },

    verifySessionToken(raw): SessionPrincipal | null {
      if (typeof raw !== 'string') return null;
      const dot = raw.indexOf('.');
      if (dot <= 0 || dot === raw.length - 1) return null;
      const payload = raw.slice(0, dot);
      const candidateSig = raw.slice(dot + 1);

      // Verify authenticity FIRST (constant-time) before trusting any field in
      // the payload — a forged/tampered token is rejected here.
      if (!sigMatches(sign(rootToken, payload), candidateSig)) return null;

      let parsed: Payload;
      try {
        parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (
        typeof parsed?.deviceId !== 'string' ||
        typeof parsed?.exp !== 'number' ||
        !Number.isFinite(parsed.exp) // defense-in-depth: NaN/Infinity reject, not just wrong-type
      ) {
        return null;
      }
      if (parsed.exp < Date.now()) return null; // expired
      if (revoked.has(parsed.deviceId)) return null; // device revoked
      return { deviceId: parsed.deviceId };
    },

    revokeDevice(deviceId): void {
      revoked.add(deviceId);
      persistRevoked();
    },
  };
}

/**
 * Load the persisted revocation set. An ABSENT file is a legitimate "nothing
 * revoked yet" — returns `[]`. A PRESENT file that is unreadable or fails to
 * parse as a JSON array is a corrupt security-relevant store: this throws
 * rather than silently returning `[]`, because collapsing a tampered/corrupt
 * file to "no revocations" would fail OPEN (un-revoking every device). Fail
 * CLOSED instead — the caller (construction) refuses to proceed.
 */
function loadRevoked(path: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Revocation file at ${path} exists but is not valid JSON — refusing to ` +
        `start with an unreadable revocation store (fail closed): ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Revocation file at ${path} exists but is not a JSON array — refusing ` +
        `to start with an unreadable revocation store (fail closed).`,
    );
  }
  return parsed.filter((d): d is string => typeof d === 'string');
}
