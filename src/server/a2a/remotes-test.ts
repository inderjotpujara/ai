/**
 * `POST /api/a2a/remotes/test` — discover/validate/pin DRY-RUN (Slice 31,
 * Task 22), mirroring the `POST /api/mcp/test-mount` "try before you commit"
 * precedent (`server/mcp/test-mount.ts`): it runs the EXACT same
 * `client.discover` pin flow `handleRemoteAdd` uses, but returns the result
 * WITHOUT ever touching the remote store — the store is byte-for-byte
 * unchanged after a test call, whether it succeeds or fails.
 *
 * `requireTrustedLocal` runs FIRST — even a probe fetch of an operator-
 * supplied URL from this process is privileged (it's the same outbound-fetch
 * surface `handleRemoteAdd` gates), so a rejected caller triggers zero
 * outbound network activity.
 */

import type { createA2aClient } from '../../a2a/client.ts';
import {
  A2aRemoteTestRequestSchema,
  A2aRemoteTestResponseSchema,
} from '../../contracts/index.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';

export type A2aRemoteTestDeps = {
  client: ReturnType<typeof createA2aClient>;
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

export async function handleRemoteTest(
  req: Request,
  deps: A2aRemoteTestDeps,
  guard: SessionGuard,
): Promise<Response> {
  // Privileged-write gate FIRST — before parsing or fetching anything.
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: ReturnType<typeof A2aRemoteTestRequestSchema.parse>;
  try {
    body = A2aRemoteTestRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // Dry-run: discover/validate/pin exactly as `handleRemoteAdd` would, but
  // there is no `remotes.add` call anywhere on this path — nothing persists.
  const discovered = await deps.client.discover(body.cardUrl);
  if (!discovered.ok) {
    return json({ error: `discover failed: ${discovered.reason}` }, 400);
  }
  return json(
    A2aRemoteTestResponseSchema.parse({
      card: discovered.card,
      pinnedCardHash: discovered.pinnedCardHash,
    }),
    200,
  );
}
