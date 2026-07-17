import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import type { SessionsDeps } from './list.ts';

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
 * `DELETE /api/sessions/:id` — cascades the session's messages in one
 * transaction (`SessionStore.deleteSession`, Increment 1). 404 if the id is
 * unknown, checked before the delete for the same observable-404 reason as
 * `handleSessionRename`.
 */
export function handleSessionDelete(deps: SessionsDeps, id: string): Response {
  if (!deps.sessionStore.getSession(id)) {
    return json({ error: 'not found' }, 404);
  }
  deps.sessionStore.deleteSession(id);
  return json({ ok: true }, 200);
}
