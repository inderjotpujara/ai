import { agentNames } from '../../../agents/index.ts';
import { CREWS } from '../../../crews/index.ts';
import { WORKFLOWS } from '../../../workflows/index.ts';
import { BuilderRegistryListResponseSchema } from '../../contracts/index.ts';
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

/** `GET /api/builders/agents` — existing agent names, for the wizard's
 *  reuse/name-collision awareness (spec §4.2 item 2). */
export function handleBuilderAgentList(): Response {
  return json(
    BuilderRegistryListResponseSchema.parse({ items: agentNames() }),
    200,
  );
}

/** `GET /api/builders/crews` — existing crew AND workflow names (the
 *  crew-builder classifies a need into either shape, so the wizard needs
 *  awareness of both registries from one call). */
export function handleBuilderCrewList(): Response {
  const items = [...Object.keys(CREWS), ...Object.keys(WORKFLOWS)];
  return json(BuilderRegistryListResponseSchema.parse({ items }), 200);
}
