/**
 * `PUT /api/a2a/skills` — replace the exposed-skill allowlist from the
 * trusted-local console (Slice 31 Task 17).
 *
 * `requireTrustedLocal` runs FIRST (editing the exposure surface is privileged
 * config), so a rejected caller (non-`local` principal / non-loopback Host /
 * bad Origin) leaves ZERO side effect — nothing is validated, nothing is
 * persisted (§7.1/§7.4). Each entry's `ref` is re-validated against the
 * in-process registries via `refExistsFor` — the SAME least-privilege check
 * `allowlist.put` applies — BEFORE any entry is written, so an unknown ref
 * fails the whole request with a 400 and leaves the persisted allowlist
 * untouched (no partial write). There is no "run anything" path: only refs that
 * resolve to a registered agent/crew/workflow for their kind are accepted.
 */

import {
  type A2aAllowlist,
  refExistsFor,
  type SkillEntry,
} from '../../a2a/allowlist.ts';
import type { A2aEnrollment } from '../../a2a/enroll.ts';
import { A2aSkillsPutRequestSchema } from '../../contracts/index.ts';
import type { JobKind } from '../../queue/types.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';
import { buildA2aConfig } from './config.ts';

export type A2aSkillsPutDeps = {
  allowlist: A2aAllowlist;
  enrollment: A2aEnrollment;
  publicBaseUrl: string;
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

export async function handleA2aSkillsPut(
  req: Request,
  deps: A2aSkillsPutDeps,
  guard: SessionGuard,
): Promise<Response> {
  // Privileged-write gate FIRST — before parsing or mutating anything — so a
  // rejected caller leaves ZERO side effect.
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: ReturnType<typeof A2aSkillsPutRequestSchema.parse>;
  try {
    body = A2aSkillsPutRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // Wire → engine `SkillEntry`. `JobKindWire`↔`JobKind` are value-identical
  // string enums (`job-kind-parity.test.ts`), the same `as unknown as` bridge
  // `server/jobs/enqueue.ts` uses.
  const entries: SkillEntry[] = body.skills.map((s) => ({
    skillId: s.skillId,
    name: s.name,
    description: s.description,
    kind: s.kind as unknown as JobKind,
    ref: s.ref,
  }));

  // Validate ALL refs up front (the same least-privilege check `allowlist.put`
  // runs internally) so an unknown ref rejects the WHOLE request with a 400 and
  // never leaves a partial write from an earlier accepted entry.
  const bad = entries.find((e) => !refExistsFor(e.kind, e.ref));
  if (bad) {
    return json(
      {
        error:
          `Cannot expose A2A skill '${bad.skillId}': ref '${bad.ref}' is not ` +
          `a registered ${bad.kind} target (§7.4 least-privilege).`,
      },
      400,
    );
  }

  for (const entry of entries) deps.allowlist.put(entry);

  // Return the updated config so the caller re-renders without a follow-up GET.
  return buildA2aConfig({
    allowlist: deps.allowlist,
    enrollment: deps.enrollment,
    publicBaseUrl: deps.publicBaseUrl,
  });
}
