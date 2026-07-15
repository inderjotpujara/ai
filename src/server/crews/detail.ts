import { getCrew } from '../../../crews/index.ts';
import { mapCrewToDetail } from '../../crew/crew-dto.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `GET /api/crews/:name` — the crew's projected detail, or 404. The name is a
 *  registry-map key (not a filesystem path), so a plain map lookup is the guard;
 *  no confineToDir is needed (nothing touches disk). */
export function handleCrewDetail(name: string): Response {
  const def = getCrew(name);
  if (!def) return json({ error: 'not found' }, 404);
  return json(mapCrewToDetail(def), 200);
}
