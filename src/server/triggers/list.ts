import { TriggerListResponseSchema } from '../../contracts/index.ts';
import type { TriggersEngine } from '../../triggers/engine.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { toTriggerDto } from './dto.ts';

export type TriggerListDeps = {
  triggers: TriggersEngine;
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

/**
 * `GET /api/triggers` — the full trigger set (repo + console origin), newest
 * first (`TriggerStore.list`'s `created_at DESC` order). Small in-memory/
 * on-disk set, so no cursor — a plain array, the `CrewListResponseSchema`
 * idiom. Behind the standard session guard, not `requireTrustedLocal` (that
 * gate is only for the mutating routes, Task 23).
 *
 * `publicBaseUrl` (optional, mirrors `TriggerDetailDeps`/`TriggerPatchDeps`)
 * threads through to `toTriggerDto` so a webhook trigger's `webhookUrl` (the
 * token-free base fire URL) is populated here too — previously only
 * create/patch passed it, leaving list's webhook rows with `webhookUrl:
 * undefined` (Slice 25 LOW-2 follow-up).
 */
export function handleTriggerList(deps: TriggerListDeps): Response {
  return json(
    TriggerListResponseSchema.parse({
      items: deps.triggers.store
        .list()
        .map((t) => toTriggerDto(t, { publicBaseUrl: deps.publicBaseUrl })),
    }),
    200,
  );
}
