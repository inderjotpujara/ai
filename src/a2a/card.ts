/**
 * A2A v1.0 Agent Card (Slice 31, §Increment 2) — builds the wire-shape card
 * advertising this orchestrator's exposed skills, straight from the
 * least-privilege allowlist (`allowlist.ts`). No "run anything" surface:
 * `skills` is exactly the allowlist's current `list()`, mapped 1:1, so an
 * empty allowlist advertises `skills: []` rather than falling back to some
 * default capability.
 *
 * `buildAgentCard` is deliberately dumb about transport/security specifics —
 * it pins a single HTTP Bearer scheme (the one auth mode this slice ships,
 * §7.2) and the one JSON-RPC endpoint (`POST {publicBaseUrl}/api/a2a`) — and
 * returns an `AgentCardSchema.parse`d object so a malformed card can never
 * leave this module undetected.
 */

import { createHash } from 'node:crypto';
import pkg from '../../package.json' with { type: 'json' };
import { type A2aAgentCard, AgentCardSchema } from '../contracts/index.ts';
import type { A2aAllowlist } from './allowlist.ts';

/** Card `description` is fixed — it describes the orchestrator, not any one
 *  skill, so it is not a per-call override. */
const CARD_DESCRIPTION =
  'Local agent orchestrator exposing registered agents, crews, and workflows as A2A skills, gated by a least-privilege allowlist.';

export function buildAgentCard(deps: {
  allowlist: A2aAllowlist;
  publicBaseUrl: string;
  name?: string;
  version?: string;
}): A2aAgentCard {
  const skills = deps.allowlist.list().map((entry) => ({
    id: entry.skillId,
    name: entry.name,
    description: entry.description,
  }));

  return AgentCardSchema.parse({
    name: deps.name ?? pkg.name,
    description: CARD_DESCRIPTION,
    version: deps.version ?? pkg.version,
    protocolVersion: '1.0',
    url: `${deps.publicBaseUrl}/api/a2a`,
    skills,
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    securitySchemes: { a2aBearer: { type: 'http', scheme: 'bearer' } },
    security: [{ a2aBearer: [] }],
  });
}

/**
 * Deterministic key-sorted serialization so the hash is insensitive to
 * property insertion order. Task 20 extracts this as the shared
 * `canonicalizeCard`/`hashCard` in `src/a2a/canonical.ts` (also used by the
 * consume-side pinning check) — `cardEtag` re-points to it there.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** `sha256` of the card's canonical (key-sorted) JSON — a stable ETag for the
 *  `GET /.well-known/agent-card.json` route (Task 6). */
export function cardEtag(card: A2aAgentCard): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(card)))
    .digest('hex');
}
