/**
 * `GET`/`POST`/`DELETE /api/a2a/remotes` — CONSUME-side remote-agent CRUD from
 * the trusted-local Federation console (Slice 31, Task 22).
 *
 * All three run `requireTrustedLocal` FIRST — adding/removing a delegation
 * target is privileged config, same class of decision as issuing/revoking an
 * expose-side Bearer (`server/a2a/token.ts`) — so a rejected caller (non-
 * `local` principal / non-loopback Host / bad Origin) leaves ZERO side effect:
 * no outbound discover fetch, nothing persisted, nothing removed (§7.1/§7.3).
 *
 * `Add` discovers + pins the remote's Agent Card via `client.discover`
 * BEFORE calling `remotes.add` — a failed discover (bad URL, non-1.0 card,
 * SSRF-blocked redirect, oversized body) is a 400 and the store is left
 * untouched; there is no path to a half-written, unpinned remote.
 *
 * `toRemoteDto` is the ONE place a `RemoteAgent` is narrowed to its wire form:
 * it strips `token` unconditionally, so neither this route nor any other
 * caller of it can accidentally leak the remote's Bearer onto the wire.
 */

import {
  cardUrlHostMismatch,
  type createA2aClient,
  type RemoteAgent,
} from '../../a2a/client.ts';
import type { RemoteStore } from '../../a2a/remotes.ts';
import {
  A2aRemoteAddRequestSchema,
  type A2aRemoteDto,
} from '../../contracts/index.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';

export type A2aRemotesDeps = {
  remotes: RemoteStore;
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

/** `RemoteAgent` → its wire DTO. Strips `token` unconditionally (§7.2/§7.3 —
 *  the remote's Bearer never round-trips once stored). */
export function toRemoteDto(r: RemoteAgent): A2aRemoteDto {
  return {
    name: r.name,
    baseUrl: r.baseUrl,
    cardUrl: r.cardUrl,
    pinnedCardHash: r.pinnedCardHash,
  };
}

export function handleRemoteList(
  req: Request,
  deps: A2aRemotesDeps,
  guard: SessionGuard,
): Response {
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;
  return json({ remotes: deps.remotes.list().map(toRemoteDto) }, 200);
}

export async function handleRemoteAdd(
  req: Request,
  deps: A2aRemotesDeps,
  guard: SessionGuard,
): Promise<Response> {
  // Privileged-write gate FIRST — before parsing, discovering, or persisting
  // anything — so a rejected caller leaves ZERO side effect.
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: ReturnType<typeof A2aRemoteAddRequestSchema.parse>;
  try {
    body = A2aRemoteAddRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // Discover + pin BEFORE persisting (§7.3): a failed/rejected discover never
  // reaches the store — no half-written, unpinned remote is ever possible.
  const discovered = await deps.client.discover(body.cardUrl);
  if (!discovered.ok) {
    return json({ error: `discover failed: ${discovered.reason}` }, 400);
  }

  // §7.3 SSRF (capstone B4): the card's advertised `url` (where delegations
  // POST) is remote-controlled — reject it unless it stays on the SAME host the
  // operator vouched for by pasting `cardUrl`, so a hostile peer cannot redirect
  // every delegation at an internal address. Nothing is persisted on mismatch.
  const mismatch = cardUrlHostMismatch(body.cardUrl, discovered.card.url);
  if (mismatch !== undefined) {
    return json({ error: `discover failed: ${mismatch}` }, 400);
  }

  const remote: RemoteAgent = {
    name: body.name,
    // The card's own `url` is the remote's JSON-RPC endpoint (the same field
    // `buildAgentCard` sets for OUR card) — trust the just-verified card, not
    // the caller-supplied cardUrl, for where invocations are sent (now
    // host-pinned to the operator's cardUrl above).
    baseUrl: discovered.card.url,
    cardUrl: body.cardUrl,
    token: body.token,
    pinnedCardHash: discovered.pinnedCardHash,
  };
  deps.remotes.add(remote);
  return json(toRemoteDto(remote), 201);
}

export function handleRemoteDelete(
  name: string,
  req: Request,
  deps: A2aRemotesDeps,
  guard: SessionGuard,
): Response {
  // Privileged-write gate FIRST — before removing anything — so a rejected
  // caller leaves ZERO side effect.
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;
  // Idempotent: an unknown / already-removed name is a safe 200 no-op.
  deps.remotes.remove(name);
  return json({ removed: true }, 200);
}
