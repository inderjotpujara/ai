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

import pkg from '../../package.json' with { type: 'json' };
import { type A2aAgentCard, AgentCardSchema } from '../contracts/index.ts';
import type { A2aAllowlist } from './allowlist.ts';
import { hashCard } from './canonical.ts';

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

/** `sha256` of the card's canonical (key-sorted) JSON — a stable ETag for the
 *  `GET /.well-known/agent-card.json` route (Task 6). Re-points to the shared
 *  `hashCard` (Task 20, `src/a2a/canonical.ts`), the same canonicalization the
 *  consume-side pin uses, so the expose ETag and the consume pin can never
 *  diverge. */
export function cardEtag(card: A2aAgentCard): string {
  return hashCard(card);
}
