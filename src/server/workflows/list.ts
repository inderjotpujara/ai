import { WORKFLOWS } from '../../../workflows/index.ts';
import { WorkflowListResponseSchema } from '../../contracts/index.ts';
import { mapWorkflowToListItem } from '../../workflow/workflow-dto.ts';
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

/** `GET /api/workflows` — every workflow in the registry, projected to summaries. */
export function handleWorkflowList(): Response {
  const items = Object.values(WORKFLOWS).map(mapWorkflowToListItem);
  return json(WorkflowListResponseSchema.parse({ items }), 200);
}
