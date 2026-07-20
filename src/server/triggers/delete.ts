import type { TriggersEngine } from '../../triggers/engine.ts';
import { TriggerOrigin } from '../../triggers/types.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';

export type TriggerDeleteDeps = {
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
 * `DELETE /api/triggers/:id` — remove a console-origin trigger (Slice 25,
 * Task 23). Behind `requireTrustedLocal` FIRST — a rejected caller leaves
 * ZERO side effect: nothing looked up, nothing removed.
 *
 * REPO-ORIGIN PROTECTION: a repo-defined trigger is code (`triggers/index.ts`)
 * — the console cannot delete it (it would just reappear on the next
 * `syncRepoTriggers` upsert anyway); the operator edits `triggers/` instead.
 * A repo-origin id → 403, never a silent no-op 200.
 *
 * A console-origin delete removes the webhook secret FIRST (if any —
 * `secretStore.remove` is a no-op on an absent ref) and then the row itself,
 * so a crash between the two can only leak an orphaned secret, never a
 * trigger row pointing at an already-removed one.
 */
export function handleTriggerDelete(
  id: string,
  req: Request,
  deps: TriggerDeleteDeps,
  guard: SessionGuard,
): Response {
  // Privileged-write gate FIRST — before any lookup/removal — so a rejected
  // caller leaves ZERO side effect.
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  const existing = deps.triggers.store.get(id);
  if (!existing) return json({ error: 'not found' }, 404);

  if (existing.origin === TriggerOrigin.Repo) {
    return json(
      { error: 'repo triggers cannot be deleted; edit `triggers/`' },
      403,
    );
  }

  if (existing.secretRef) {
    deps.triggers.secretStore.remove(existing.secretRef);
  }
  deps.triggers.store.remove(id);
  return json({ deleted: true }, 200);
}
