import { CREWS } from '../../../crews/index.ts';
import { CrewListResponseSchema } from '../../contracts/index.ts';
import { mapCrewToListItem } from '../../crew/crew-dto.ts';
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

/** `GET /api/crews` — every crew in the registry, projected to summaries. */
export function handleCrewList(): Response {
  const items = Object.values(CREWS).map(mapCrewToListItem);
  return json(CrewListResponseSchema.parse({ items }), 200);
}
