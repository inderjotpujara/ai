import { SessionRenameRequestSchema } from '../../contracts/index.ts';
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
 * `PATCH /api/sessions/:id` — renames a session. 404 if the id is unknown,
 * checked BEFORE the rename write: `SessionStore.renameSession` (Increment 1)
 * is itself a silent no-op on a missing id (a plain `UPDATE` with no matching
 * row), so this handler is what turns that into an observable 404 rather
 * than a misleading 200 for a rename that never happened.
 */
export async function handleSessionRename(
  req: Request,
  deps: SessionsDeps,
  id: string,
): Promise<Response> {
  if (!deps.sessionStore.getSession(id)) {
    return json({ error: 'not found' }, 404);
  }
  let body: ReturnType<typeof SessionRenameRequestSchema.parse>;
  try {
    body = SessionRenameRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  deps.sessionStore.renameSession(id, body.title, Date.now());
  return json({ ok: true }, 200);
}
