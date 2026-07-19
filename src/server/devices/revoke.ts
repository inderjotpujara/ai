import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { DeviceRegistry } from '../security/device-registry.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionTokenStore } from '../security/session-token.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';
import { recordDeviceRevoke } from './spans.ts';

export type DeviceRevokeDeps = {
  deviceRegistry: DeviceRegistry;
  sessionTokens: SessionTokenStore;
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

/**
 * `POST /api/devices/:id/revoke` — revoke one device (D4/D5, §7.1). Does BOTH:
 * `revokeDevice` adds the id to the persisted NEGATIVE set (so the stateless
 * HMAC session token stops verifying — the naive failure mode is dropping the
 * registry row but leaving the still-valid token alive) AND `remove` prunes the
 * POSITIVE registry row (so it disappears from `GET /api/devices`).
 *
 * Gated by `requireTrustedLocal` FIRST — before any mutation — so a rejected
 * caller (a paired remote device, or a `'local'` token replayed over a tunnel)
 * gets a 403 with ZERO side effect: nothing revoked, nothing pruned. Revoke is
 * idempotent: an unknown / already-revoked id is a safe no-op that still
 * returns `200 {revoked:true}` (adding to a Set / filtering a list never
 * throws) and never affects any OTHER device. The `id` is a plain opaque path
 * segment used only as a Set key / registry filter value — it never touches the
 * filesystem, so a traversal-shaped id cannot escape.
 */
export function handleDeviceRevoke(
  id: string,
  req: Request,
  deps: DeviceRevokeDeps,
  guard: SessionGuard,
): Response {
  // Privileged-write gate FIRST — before revoking/pruning anything — so a
  // rejected caller leaves ZERO side effect.
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  // Close the token (negative set) AND prune the registry row (positive list).
  // Both are required: skipping the negative set would leave the revoked
  // device's still-valid HMAC token verifying forever.
  deps.sessionTokens.revokeDevice(id);
  deps.deviceRegistry.remove(id);
  recordDeviceRevoke(id, 'local');
  return json({ revoked: true }, 200);
}
