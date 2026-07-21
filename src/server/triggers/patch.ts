import {
  type TriggerPatchRequest,
  TriggerPatchRequestSchema,
  type TriggerTypeWire,
} from '../../contracts/index.ts';
import type { TriggersEngine } from '../../triggers/engine.ts';
import { computeNextRun } from '../../triggers/next-run.ts';
import type { TriggerStore } from '../../triggers/store.ts';
import {
  type Trigger,
  TriggerOrigin,
  type TriggerTarget,
  TriggerType,
} from '../../triggers/types.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';
import { parseTriggerConfig } from './config-parse.ts';
import { toTriggerDto } from './dto.ts';

export type TriggerPatchDeps = {
  triggers: TriggersEngine;
  policy: OriginPolicy;
  publicBaseUrl?: string;
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

type StorePatch = Parameters<TriggerStore['update']>[1];

/**
 * `PATCH /api/triggers/:id` — partial update (Slice 25, Task 23). Behind
 * `requireTrustedLocal` FIRST, mirroring the create/delete handlers.
 *
 * REPO-ORIGIN PROTECTION: a repo-defined trigger is code, not a console
 * document — PATCH may only flip `enabled` (the pause/resume overlay
 * `TriggerStore.upsertRepo` already preserves across a repo re-sync). Any
 * OTHER field (`target`/`config`) in the same request is rejected with 403,
 * even if `enabled` is also present — a partial "apply what's allowed, reject
 * the rest" would silently drop the caller's intended edit.
 *
 * For a console-origin row, `config` (when present) is re-validated against
 * the trigger's OWN (immutable-via-patch) `type` through the same
 * `parseTriggerConfig` create uses — the same 400-on-bad-cron /
 * 400-on-escaping-path guarantees apply to an edit, not just a create.
 *
 * `nextRunAt` is recomputed for a cron trigger when the edit could have
 * invalidated the previously-computed value: a `config` change (the schedule/
 * timezone it was computed from may have changed) or `enabled` flipping to
 * `true` while `nextRunAt` is currently unset (a parked row — e.g. a
 * previously-uncomputable pattern — must be re-seeded, not left un-scheduled
 * forever).
 */
export async function handleTriggerPatch(
  id: string,
  req: Request,
  deps: TriggerPatchDeps,
  guard: SessionGuard,
): Promise<Response> {
  // Privileged-write gate FIRST — before even looking up the row — so a
  // rejected caller leaves ZERO side effect.
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  const existing = deps.triggers.store.get(id);
  if (!existing) return json({ error: 'not found' }, 404);

  let body: TriggerPatchRequest;
  try {
    body = TriggerPatchRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  if (existing.origin === TriggerOrigin.Repo) {
    // Pause/resume-only: reject any attempt to touch target/config, even
    // alongside a legitimate `enabled` flip in the same request.
    if (body.target !== undefined || body.config !== undefined) {
      return json(
        { error: 'repo triggers are pause/resume-only (enabled only)' },
        403,
      );
    }
  }

  const patch: StorePatch = {};
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.target !== undefined) {
    patch.target = body.target as unknown as TriggerTarget;
  }
  if (body.config !== undefined) {
    try {
      // The trigger's `type` is immutable via patch (not a patchable field) —
      // TriggerType <-> TriggerTypeWire are isomorphic string enums (the
      // `enqueue.ts` idiom), so this cast is safe.
      patch.config = parseTriggerConfig(
        existing.type as unknown as TriggerTypeWire,
        body.config,
      );
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : 'invalid config' },
        400,
      );
    }
  }

  if (existing.type === TriggerType.Cron) {
    const willBeEnabled = patch.enabled ?? existing.enabled;
    const configChanged = 'config' in patch;
    const needsRecompute =
      configChanged || (willBeEnabled && existing.nextRunAt == null);
    if (needsRecompute) {
      const merged: Trigger = configChanged
        ? {
            ...existing,
            config: patch.config as NonNullable<typeof patch.config>,
          }
        : existing;
      patch.nextRunAt = computeNextRun(merged, Date.now()) ?? undefined;
    }
  }

  const updated = deps.triggers.store.update(id, patch);
  if (!updated) return json({ error: 'not found' }, 404);
  return json(
    toTriggerDto(updated, { publicBaseUrl: deps.publicBaseUrl }),
    200,
  );
}
