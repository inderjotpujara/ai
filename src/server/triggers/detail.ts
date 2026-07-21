import type { TriggersEngine } from '../../triggers/engine.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { toTriggerDto } from './dto.ts';

export type TriggerDetailDeps = {
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

/** `GET /api/triggers/:id` — the full `TriggerDTO`, or 404 for an unknown id
 *  (same shape as `handleJobDetail`'s 404). `publicBaseUrl` (optional, mirrors
 *  `TriggerListDeps`/`TriggerPatchDeps`) threads through to `toTriggerDto` so
 *  a webhook trigger's `webhookUrl` (the token-free base fire URL) is
 *  populated here too (Slice 25 LOW-2 follow-up). */
export function handleTriggerDetail(
  id: string,
  deps: TriggerDetailDeps,
): Response {
  const trigger = deps.triggers.store.get(id);
  if (!trigger) return json({ error: 'not found' }, 404);
  return json(
    toTriggerDto(trigger, { publicBaseUrl: deps.publicBaseUrl }),
    200,
  );
}
