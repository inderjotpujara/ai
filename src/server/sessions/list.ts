import { ZodError } from 'zod';
import {
  SessionListQuerySchema,
  SessionListResponseSchema,
} from '../../contracts/index.ts';
import type { SessionStore } from '../../session/store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/** Shared by every `src/server/sessions/*.ts` handler in this plan — mirrors
 *  `RunsDeps`'s single-canonical-home precedent (`src/server/runs/detail.ts`). */
export type SessionsDeps = { sessionStore: SessionStore };

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
 * `GET /api/sessions?search=&cursor=&limit=` — a keyset-paged list of session
 * summaries (spec D10). `SessionStore.listSessions` (Increment 1) already
 * returns the FULL `{items, nextCursor?, total}` shape with `items` already
 * `SessionListItemDTO[]` — this handler only parses the query string and
 * re-validates the store's own output against the wire schema, matching
 * `handleRunList`'s division of labor (`src/server/runs/list.ts`).
 */
export function handleSessionList(
  params: URLSearchParams,
  deps: SessionsDeps,
): Response {
  let query: ReturnType<typeof SessionListQuerySchema.parse>;
  try {
    query = SessionListQuerySchema.parse({
      search: params.get('search') ?? undefined,
      limit: params.get('limit') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
    });
  } catch (err) {
    if (err instanceof ZodError) return json({ error: 'bad request' }, 400);
    throw err;
  }
  const page = deps.sessionStore.listSessions(query);
  return json(SessionListResponseSchema.parse(page), 200);
}
