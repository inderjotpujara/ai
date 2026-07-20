import type { TriggersEngine } from '../../triggers/engine.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { toTriggerDto } from './dto.ts';

export type TriggerDetailDeps = { triggers: TriggersEngine };

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
 *  (same shape as `handleJobDetail`'s 404). */
export function handleTriggerDetail(
  id: string,
  deps: TriggerDetailDeps,
): Response {
  const trigger = deps.triggers.store.get(id);
  if (!trigger) return json({ error: 'not found' }, 404);
  return json(toTriggerDto(trigger), 200);
}
