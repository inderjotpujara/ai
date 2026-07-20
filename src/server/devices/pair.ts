import { randomUUID } from 'node:crypto';
import {
  DevicePairRequestSchema,
  DevicePairResponseSchema,
} from '../../contracts/index.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { DeviceRegistry } from '../security/device-registry.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionTokenStore } from '../security/session-token.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';
import { recordDevicePair } from './spans.ts';

export type DevicePairDeps = {
  deviceRegistry: DeviceRegistry;
  sessionTokens: SessionTokenStore;
  publicBaseUrl: string;
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

/**
 * `POST /api/devices` — pair a new device (D4/D5/§7.1). Gated by BOTH the
 * inherited session guard AND `requireTrustedLocal` (you pair FROM the
 * physically-local browser: `principal === 'local'` + a LOOPBACK Host + an
 * allowed Origin). The server MINTS the deviceId (`crypto.randomUUID()`) — a
 * client-supplied `deviceId` in the body is NEVER trusted (the IDOR defense:
 * `DevicePairRequestSchema` accepts ONLY `label`, and the minted id always wins,
 * so a remote can neither choose its identity nor overwrite `'local'`). The
 * minted token is returned EXACTLY ONCE here and is NEVER persisted to the
 * registry (which stores only `{deviceId,label,createdAt,exp}`) nor re-listed by
 * `GET /api/devices`. The token rides the pairing URL's `#fragment` — never a
 * `?query` — so it is never sent to a server or written to an access log.
 */
export async function handleDevicePair(
  req: Request,
  deps: DevicePairDeps,
  guard: SessionGuard,
): Promise<Response> {
  // Privileged-write gate FIRST — before parsing the body or minting anything,
  // so a rejected caller (non-'local' principal / non-loopback Host / bad
  // Origin) leaves ZERO side effect (no token minted, nothing appended).
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: ReturnType<typeof DevicePairRequestSchema.parse>;
  try {
    // Parse (not passthrough): only `label` is honored. Any `deviceId` the
    // client smuggles into the body is dropped here and can never reach the
    // mint/append below.
    body = DevicePairRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const deviceId = randomUUID(); // SERVER-minted; a body `deviceId` is ignored.
  const createdAt = Date.now();
  const ttlMs = deps.bindInfo.sessionTtlMs;
  const exp = createdAt + ttlMs;
  const token = deps.sessionTokens.mintSessionToken({ deviceId, ttlMs });
  // Registry persists the four durable fields ONLY — never the token.
  deps.deviceRegistry.append({ deviceId, label: body.label, createdAt, exp });
  recordDevicePair(deviceId, 'local');
  // Token in the URL #fragment, NOT a ?query — fragments are never sent to the
  // server nor written to proxy/access logs.
  const pairingUrl = `${deps.publicBaseUrl}/#token=${token}`;
  return json(
    DevicePairResponseSchema.parse({ deviceId, token, pairingUrl }),
    202,
  );
}
