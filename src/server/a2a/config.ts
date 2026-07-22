/**
 * `GET /api/a2a/config` — the trusted-local A2A config view (Slice 31 Task 17).
 *
 * This is the read the Federation tab (Increment 7) renders: the expose-surface
 * enable state, the exposed-skill allowlist, a PREVIEW of the advertised agent
 * card, and issued-Bearer METADATA. It is metadata-only by construction — the
 * token list comes from `enrollment.list()`, which returns `{ id, label,
 * createdAt }` and NEVER the raw token nor its on-disk fingerprint (§7.2). The
 * raw secret is transmitted exactly once, from `POST /api/a2a/token`.
 *
 * The route is gated by `requireTrustedLocal` in `app.ts` (viewing issued
 * tokens / the exposure surface is privileged config), so this handler takes no
 * `req`/`guard` — the perimeter is enforced before it runs.
 */

import type { A2aAllowlist, SkillEntry } from '../../a2a/allowlist.ts';
import { buildAgentCard } from '../../a2a/card.ts';
import type { A2aEnrollment } from '../../a2a/enroll.ts';
import { loadConfig } from '../../config/schema.ts';
import {
  A2aConfigResponseSchema,
  type A2aSkillEntryWire,
  type JobKindWire,
} from '../../contracts/index.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type A2aConfigDeps = {
  allowlist: A2aAllowlist;
  enrollment: A2aEnrollment;
  publicBaseUrl: string;
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

/** Engine `SkillEntry` → its isomorphic wire form. `JobKind`↔`JobKindWire` are
 *  value-identical string enums (`job-kind-parity.test.ts`), the same
 *  `as unknown as` bridge `server/jobs/enqueue.ts` uses. */
export function toWireSkill(entry: SkillEntry): A2aSkillEntryWire {
  return {
    skillId: entry.skillId,
    name: entry.name,
    description: entry.description,
    kind: entry.kind as unknown as JobKindWire,
    ref: entry.ref,
  };
}

/** Build the trusted-local config view. Shared by `handleA2aConfig` (the GET
 *  route) and `handleA2aSkillsPut` (which returns the updated config). */
export function buildA2aConfig(deps: A2aConfigDeps): Response {
  const enabled = loadConfig().values.AGENT_A2A_ENABLED === true;
  const skills = deps.allowlist.list().map(toWireSkill);
  const cardPreview = buildAgentCard({
    allowlist: deps.allowlist,
    publicBaseUrl: deps.publicBaseUrl,
  });
  // Metadata only — `list()` returns `{ id, label, createdAt }`, never a secret.
  const tokens = deps.enrollment.list();
  return json(
    A2aConfigResponseSchema.parse({ enabled, skills, cardPreview, tokens }),
    200,
  );
}

export function handleA2aConfig(deps: A2aConfigDeps): Response {
  return buildA2aConfig(deps);
}
