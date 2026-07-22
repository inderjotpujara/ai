/**
 * `POST /api/a2a/token` + `DELETE /api/a2a/token/:id` — issue / revoke an A2A
 * Bearer from the trusted-local console (Slice 31 Task 17).
 *
 * Both handlers run `requireTrustedLocal` FIRST — minting an exposure
 * credential and revoking one are privileged config — so a rejected caller
 * (non-`local` principal / non-loopback Host / bad Origin) leaves ZERO side
 * effect: no token minted on issue, nothing removed on revoke (§7.1). The raw
 * Bearer is returned EXACTLY ONCE, from `issue()` (the `DevicePairResponse`
 * precedent); it is never persisted raw and never re-listed by
 * `GET /api/a2a/config` (which carries only `{ id, label, createdAt }`). Revoke
 * is idempotent: `enrollment.revoke` filters the registry, so an unknown /
 * already-revoked id is a safe 200 no-op. The `:id` is a plain opaque registry
 * key — it never touches the filesystem, so a traversal-shaped id cannot escape.
 */

import type { A2aEnrollment } from '../../a2a/enroll.ts';
import {
  A2aTokenIssueRequestSchema,
  A2aTokenIssueResponseSchema,
} from '../../contracts/index.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';

export type A2aTokenDeps = {
  enrollment: A2aEnrollment;
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

export async function handleA2aTokenIssue(
  req: Request,
  deps: A2aTokenDeps,
  guard: SessionGuard,
): Promise<Response> {
  // Privileged-write gate FIRST — before parsing the body or minting anything —
  // so a rejected caller leaves ZERO side effect (no token minted).
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: ReturnType<typeof A2aTokenIssueRequestSchema.parse>;
  try {
    body = A2aTokenIssueRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // The raw token is transmitted EXACTLY ONCE here — never persisted raw, never
  // re-listed by GET /api/a2a/config.
  const { id, token } = deps.enrollment.issue(body.label);
  return json(A2aTokenIssueResponseSchema.parse({ id, token }), 201);
}

export function handleA2aTokenRevoke(
  id: string,
  req: Request,
  deps: A2aTokenDeps,
  guard: SessionGuard,
): Response {
  // Privileged-write gate FIRST — before removing anything — so a rejected
  // caller leaves ZERO side effect (nothing revoked).
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  // Idempotent: an unknown / already-revoked id is a safe no-op that still
  // returns 200. The id is a plain registry key — it never touches the FS.
  deps.enrollment.revoke(id);
  return json({ revoked: true }, 200);
}
