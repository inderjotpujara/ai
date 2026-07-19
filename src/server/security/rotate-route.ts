import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { RotateRootRequestSchema } from '../../contracts/index.ts';
import { recordRotateRoot } from '../devices/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { DeviceRegistry } from './device-registry.ts';
import type { OriginPolicy } from './origin.ts';
import type { RootTokenStore } from './root-token.ts';
import { rotateRoot } from './rotate.ts';
import type { SessionTokenStore } from './session-token.ts';
import type { SessionGuard } from './token.ts';
import { requireTrustedLocal } from './trusted-local.ts';

export type RotateRootDeps = {
  rootTokens: RootTokenStore;
  sessionTokens: SessionTokenStore;
  deviceRegistry: DeviceRegistry;
  bindInfo: { sessionTtlMs: number };
  policy: OriginPolicy;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** Constant-time secret compare (the token.ts / session-token.ts idiom): equal
 *  length then `timingSafeEqual`, never a content-dependent `===`. A length
 *  mismatch returns `false` up front (buffers of unequal length can't be fed to
 *  `timingSafeEqual`) — no early-exit char-by-char leak either way. */
function secretMatches(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * `POST /api/security/rotate-root` — break-glass mass session-invalidation
 * (D5/§7.1d,e). Trusted-local gated FIRST, THEN re-confirms possession of the
 * root secret (constant-time). On success: rotate the root (all other sessions
 * die), clear the device registry, and return the re-minted local token so the
 * operator's own tab keeps working (anti-self-DoS). NEVER logs/echoes the root
 * or the submitted secret — the span carries the principal only.
 */
export async function handleRotateRoot(
  req: Request,
  deps: RotateRootDeps,
  guard: SessionGuard,
): Promise<Response> {
  // Privileged-write gate FIRST — before parsing the body, comparing the secret,
  // or mutating anything — so a rejected caller (non-'local' principal /
  // non-loopback Host / bad Origin) leaves ZERO side effect (§7.1: gate first).
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: ReturnType<typeof RotateRootRequestSchema.parse>;
  try {
    body = RotateRootRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // Re-confirm possession of the CURRENT root, constant-time. A wrong secret
  // (an already-authenticated-but-not-root caller, or a CSRF-ish write) → 401
  // with the root + registry + every session UNTOUCHED (§7.1d).
  if (!secretMatches(deps.rootTokens.getOrCreateRoot(), body.rootSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const { localToken } = rotateRoot({
    rootTokens: deps.rootTokens,
    sessionTokens: deps.sessionTokens,
    sessionTtlMs: deps.bindInfo.sessionTtlMs,
  });
  deps.deviceRegistry.clear(); // every paired device's token is dead now
  recordRotateRoot('local'); // principal only — never the root or the secret
  return json({ token: localToken }, 200);
}
