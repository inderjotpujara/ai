import { JobLaunchResponseSchema } from '../../contracts/index.ts';
import type { TriggersEngine } from '../../triggers/engine.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';

export type TriggerFireDeps = {
  triggers: TriggersEngine;
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
 * `POST /api/triggers/:id/fire` — manual test-fire (Slice 25, Task 24): the
 * operator's "test this trigger now" button. Behind `requireTrustedLocal`
 * FIRST, mirroring the other mutating trigger routes — a rejected caller
 * leaves ZERO side effect (nothing looked up, nothing fired). Unknown id →
 * 404.
 *
 * F1 TRUST-BOUNDARY (T9 adversarial carry): the request body is NEVER read.
 * A manual test-fire always starts a FRESH chain — `chainDepth` is omitted
 * from the `FireContext` entirely (server-defaulted to 0 inside `fire.ts`)
 * rather than accepted from the client. `fire.ts`'s T9 finding named
 * manual-fire specifically as a potential §7.3 chain-cap evasion vector; not
 * parsing the body at all closes it by construction — there is no field a
 * caller could smuggle a `chainDepth` (or anything else) through.
 *
 * `bypassOverlap: true` — a test-fire is expected to work even while a prior
 * fire's job is still in flight (`fire.ts`'s overlap protection is meant for
 * the scheduled/webhook/chain sources, not an operator explicitly asking to
 * fire right now).
 *
 * On the (effectively unreachable in practice — see `fire.ts`'s N2 clamp)
 * chance the convergence point still declines to fire — `bypassOverlap`
 * already forecloses `SkippedOverlap`, so only a `Failed` chain-cap outcome
 * remains, and that requires a misconfigured non-negative `maxChainDepth()`
 * — surface it as a 500 rather than fabricate a jobId/runId that were never
 * minted.
 */
export async function handleTriggerFire(
  id: string,
  req: Request,
  deps: TriggerFireDeps,
  guard: SessionGuard,
): Promise<Response> {
  // Privileged-write gate FIRST — before even looking up the row — so a
  // rejected caller leaves ZERO side effect.
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  const trigger = deps.triggers.store.get(id);
  if (!trigger) return json({ error: 'not found' }, 404);

  // No body parsing: a manual fire never reads chainDepth (or anything else)
  // from the request — see the F1 note above.
  const result = await deps.triggers.fire(trigger, {
    reason: 'manual',
    bypassOverlap: true,
  });

  if (!result.fired) {
    return json({ error: `fire failed: ${result.outcome}` }, 500);
  }
  return json(
    JobLaunchResponseSchema.parse({
      jobId: result.jobId,
      runId: result.runId,
    }),
    202,
  );
}
