/**
 * A2A Bearer enrollment — issue / verify / revoke the D5 credential that
 * authenticates inbound `POST /api/a2a` calls (Slice 31, §7.2 SECURITY).
 *
 * An A2A Bearer is SEPARATE from a per-device session token
 * (`server/security/session-token.ts`): both are HMAC-signed by the SAME daemon
 * root (`server/security/root-token.ts`), but each carries a distinct signed
 * payload shape, and each is checked against its OWN store. That two-fold
 * separation is what makes the two token domains provably DISJOINT (D5): an A2A
 * Bearer's payload carries `{ tokenId, kind: 'a2a' }` and is checked against the
 * issued-token registry here; a session token's payload carries
 * `{ deviceId, exp }` and is checked against the device revocation set there.
 * Neither verifier accepts the other's payload — a session token has no
 * `kind:'a2a'`/`tokenId`, and an A2A Bearer has no `deviceId`/`exp` — so sharing
 * the root key does NOT collapse the domains.
 *
 *     payload = base64url({ tokenId, kind: 'a2a' })
 *     sig     = HMAC-SHA256(root, payload)
 *     token   = `${payload}.${sig}`
 *
 * The root is resolved PER CALL (the `session-token.ts` `currentRoot()` idiom),
 * never captured at construction, so a `rotate()` of the root invalidates EVERY
 * outstanding A2A Bearer at once — their sigs no longer verify against the new
 * key. `verify` is constant-time: the signature compare reuses the same
 * `timingSafeEqual`-with-length-guard pattern as `session-token.ts` (no
 * content-dependent `===` on secret material, never throws on a length
 * mismatch).
 *
 * The registry persists ONLY `{ id, label, createdAt }` plus a non-reversible
 * `hash` fingerprint of the issued token — NEVER the raw token. The secret is
 * returned exactly ONCE, from `issue()`, and is never logged, never a DTO field
 * (`list()` returns metadata only), never a span attribute (§7.2). Atomic
 * temp+rename writes and fail-closed load mirror `device-registry.ts`.
 */

import { Buffer } from 'node:buffer';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config/schema.ts';
import type { RootTokenStore } from '../server/security/root-token.ts';

/** The A2A Bearer payload discriminator — makes an A2A token UNMISTAKABLE for a
 *  device session token (which has no such field). */
const A2A_KIND = 'a2a';

/** Public issued-token metadata — NEVER the secret, NEVER the fingerprint. */
export type IssuedToken = { id: string; label: string; createdAt: number };

export type A2aEnrollment = {
  /** Mint an A2A Bearer HMAC-derived from the CURRENT root; the token is
   *  PRINTED ONCE and never stored raw (only its id + a hash reach disk). */
  issue(label: string): { id: string; token: string };
  /** Constant-time verify: true iff `raw` is an unrevoked A2A Bearer signed by
   *  the CURRENT root. */
  verify(raw: string): boolean;
  revoke(id: string): void;
  list(): IssuedToken[];
};

/** On-disk record: metadata + a one-way fingerprint. NEVER the raw token. */
type StoredToken = {
  id: string;
  label: string;
  createdAt: number;
  hash: string;
};

/** The signed wire payload of an A2A Bearer. */
type A2aPayload = { tokenId: string; kind: typeof A2A_KIND };

/** Default registry location: sits BESIDE the allowlist store
 *  (`AGENT_A2A_SKILLS_PATH`), same dir/discipline (`a2a/allowlist.ts`). */
export function defaultA2aRegistryPath(): string {
  const skillsPath = String(loadConfig().values.AGENT_A2A_SKILLS_PATH);
  return join(dirname(skillsPath), 'a2a-tokens.json');
}

/** HMAC-SHA256 of `payload` keyed by the root token, hex-encoded — the SAME
 *  construction as `session-token.ts`. */
function sign(rootToken: string, payload: string): string {
  return createHmac('sha256', rootToken).update(payload).digest('hex');
}

/**
 * Constant-time signature compare — the SAME timing-safe pattern
 * `session-token.ts` uses: `timingSafeEqual` on equal-length buffers with a
 * length guard so a mismatched length returns `false` instead of throwing. No
 * hand-rolled `===` on secret material anywhere.
 */
function sigMatches(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createA2aEnrollment(deps: {
  rootTokens: RootTokenStore;
  registryPath?: string;
}): A2aEnrollment {
  const path = deps.registryPath ?? defaultA2aRegistryPath();

  // Resolve the root PER CALL (never capture it by value) — the
  // `session-token.ts:76` idiom. A captured string would keep signing/verifying
  // with the STALE root after `rotate()`, making rotate a no-op on this live
  // store; resolving per call is exactly what lets rotate invalidate every
  // outstanding A2A Bearer at once.
  const currentRoot = (): string => deps.rootTokens.getOrCreateRoot();

  // Fail-closed at construction: a present-but-corrupt registry throws rather
  // than silently collapsing to "no tokens" (which would un-list every issued
  // Bearer, dropping the audit trail).
  let tokens: StoredToken[] = load(path);

  // Atomic write mirroring `device-registry.ts`: serialize to a unique 0600
  // temp in the SAME dir, then rename over the target (atomic within a
  // filesystem) so a crash mid-write can never leave a truncated registry.
  function persist(): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(tokens), { mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort cleanup; surface the original failure below
      }
      throw err;
    }
  }

  return {
    issue(label: string): { id: string; token: string } {
      const tokenId = randomBytes(16).toString('hex');
      const payloadObj: A2aPayload = { tokenId, kind: A2A_KIND };
      const payload = Buffer.from(JSON.stringify(payloadObj)).toString(
        'base64url',
      );
      const token = `${payload}.${sign(currentRoot(), payload)}`;
      // Store a one-way fingerprint, NEVER the raw token: enough to correlate a
      // presented token in an audit, impossible to reverse into the secret.
      const hash = createHash('sha256').update(token).digest('hex');
      tokens = [
        ...tokens.filter((t) => t.id !== tokenId),
        { id: tokenId, label, createdAt: Date.now(), hash },
      ];
      persist();
      return { id: tokenId, token };
    },

    verify(raw: string): boolean {
      if (typeof raw !== 'string') return false;
      const dot = raw.indexOf('.');
      if (dot <= 0 || dot === raw.length - 1) return false;
      const payload = raw.slice(0, dot);
      const candidateSig = raw.slice(dot + 1);

      // Authenticity FIRST (constant-time), before trusting any payload field —
      // recomputed with the CURRENT root so a rotate invalidates every Bearer.
      if (!sigMatches(sign(currentRoot(), payload), candidateSig)) return false;

      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        return false;
      }
      // D5 discriminator: reject anything that is not explicitly an A2A payload.
      // A device session token's payload has no `kind:'a2a'`/`tokenId`, so it is
      // rejected here even though its sig would match the shared root.
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as A2aPayload).kind !== A2A_KIND ||
        typeof (parsed as A2aPayload).tokenId !== 'string'
      ) {
        return false;
      }
      const { tokenId } = parsed as A2aPayload;

      // Re-read the registry so a revoke written by ANY process takes effect
      // immediately (matches `allowlist.ts` `resolve`). Membership == issued and
      // not revoked; `revoke` removes the row.
      return load(path).some((t) => t.id === tokenId);
    },

    revoke(id: string): void {
      tokens = load(path).filter((t) => t.id !== id);
      persist();
    },

    list(): IssuedToken[] {
      // Metadata only — the `hash` fingerprint stays on disk, never in the DTO.
      return load(path).map((t) => ({
        id: t.id,
        label: t.label,
        createdAt: t.createdAt,
      }));
    },
  };
}

/**
 * Load the registry. An ABSENT file is a legitimate "nothing issued yet" → `[]`.
 * A PRESENT-but-corrupt file (unparseable JSON, or not a JSON array) THROWS —
 * fail closed: silently collapsing a tampered/unreadable registry to "no
 * tokens" would drop the audit trail and un-list every issued Bearer. Mirrors
 * `load` in `device-registry.ts`.
 */
function load(path: string): StoredToken[] {
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
      `A2A token registry at ${path} exists but is not valid JSON — refusing ` +
        `to start with an unreadable token store (fail closed): ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `A2A token registry at ${path} exists but is not a JSON array — ` +
        `refusing to start with an unreadable token store (fail closed).`,
    );
  }
  return parsed
    .filter(
      (t): t is StoredToken =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as StoredToken).id === 'string' &&
        typeof (t as StoredToken).label === 'string' &&
        typeof (t as StoredToken).createdAt === 'number' &&
        typeof (t as StoredToken).hash === 'string',
    )
    .map((t) => ({
      id: t.id,
      label: t.label,
      createdAt: t.createdAt,
      hash: t.hash,
    }));
}
