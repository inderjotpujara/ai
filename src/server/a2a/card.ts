/**
 * `GET /.well-known/agent-card.json` — the A2A public discovery route
 * (Slice 31, Increment 2). This is the ONE unauthenticated read on the EXPOSE
 * surface: a remote orchestrator fetches it (no Bearer) to learn which skills
 * this agent advertises, before enrolling for a token. Route placement is in
 * `app.ts` (after the Host/Origin perimeter, before the `/api` session guard);
 * this module owns the fail-safe + caching contract:
 *
 * - **404 when `AGENT_A2A_ENABLED` is off (fail-safe).** Discovery reveals
 *   NOTHING until an operator turns the expose surface on — a card served while
 *   disabled would advertise internal capability (skill ids/descriptions) to
 *   any caller past the perimeter. The 404 is indistinguishable from "no such
 *   route", so a disabled daemon leaks neither the card nor the fact that A2A
 *   exists here.
 * - **Cacheable, revalidatable.** A `200` carries a strong `ETag` (sha256 of
 *   the canonical card, from `cardEtag`) and `Cache-Control: public,
 *   max-age=<AGENT_A2A_CARD_TTL>`; a conditional `If-None-Match` that matches
 *   short-circuits to `304`. `recordA2aCard({ cacheHit })` emits the
 *   `a2a.server.card` span either way.
 */

import type { A2aAllowlist } from '../../a2a/allowlist.ts';
import { buildAgentCard, cardEtag } from '../../a2a/card.ts';
import { recordA2aCard } from '../../a2a/spans.ts';
import { loadConfig } from '../../config/schema.ts';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** A disabled/unknown route: an intentionally featureless 404 so a caller
 *  cannot distinguish "A2A off" from "no such path" (no capability leak). */
function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not found' }), {
    status: 404,
    headers: JSON_HEADERS,
  });
}

/** Does an `If-None-Match` header (a comma list, or `*`) match `etag`? The
 *  client echoes back exactly the strong ETag we issued, so a strict
 *  equality-per-token comparison is sufficient; `*` matches unconditionally
 *  per RFC 9110. */
function ifNoneMatchHit(header: string | null, etag: string): boolean {
  if (header === null) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((tag) => tag.trim() === etag);
}

export function handleAgentCard(
  req: Request,
  deps: { allowlist: A2aAllowlist; publicBaseUrl: string },
): Response {
  const config = loadConfig().values;
  // Fail-safe: the expose surface is dark until an operator enables it.
  if (config.AGENT_A2A_ENABLED !== true) return notFound();

  const card = buildAgentCard({
    allowlist: deps.allowlist,
    publicBaseUrl: deps.publicBaseUrl,
  });
  // Strong, quoted ETag (RFC 9110 entity-tag syntax) over the canonical card.
  const etag = `"${cardEtag(card)}"`;
  const ttl = config.AGENT_A2A_CARD_TTL as number;
  const cacheControl = `public, max-age=${ttl}`;

  const cacheHit = ifNoneMatchHit(req.headers.get('if-none-match'), etag);
  recordA2aCard({ cacheHit });

  if (cacheHit) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': cacheControl },
    });
  }
  return new Response(JSON.stringify(card), {
    status: 200,
    headers: { ...JSON_HEADERS, etag, 'cache-control': cacheControl },
  });
}
