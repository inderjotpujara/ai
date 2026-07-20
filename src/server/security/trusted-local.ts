/**
 * Trusted-local privileged-write gate (Slice 25b, D5). Pairing / revoke /
 * rotate-root are gated by BOTH the standard session guard (inherited by every
 * /api route) AND this: the request must come from the TRUSTED LOCAL principal
 * — `guard.principal(req) === 'local'` (only the local-minted session token
 * carries deviceId 'local'; a paired remote device has a random UUID) AND a
 * LOOPBACK Host (`isLoopbackHost`, NOT merely an allowlisted tunnel host) AND a
 * same-/allowed-origin. So you pair NEW devices FROM the physically-local
 * browser, and neither a paired remote device NOR a client that replayed the
 * injected `'local'` token over a tunnel can mint/revoke/rotate. Returns a 403
 * Response on failure, else null.
 */
import { isLoopbackHost, type OriginPolicy, originAllowed } from './origin.ts';
import type { SessionGuard } from './token.ts';

export function requireTrustedLocal(
  req: Request,
  guard: SessionGuard,
  policy: OriginPolicy,
): Response | null {
  const principal = guard.principal(req);
  const trusted =
    principal === 'local' &&
    isLoopbackHost(req) && // a LOOPBACK Host specifically — an allowed tunnel host is NOT enough
    originAllowed(req, policy);
  if (trusted) return null;
  return new Response(
    JSON.stringify({ error: 'forbidden: trusted-local only' }),
    {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
  );
}
