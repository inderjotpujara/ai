import { getWorkflow } from '../../../workflows/index.ts';
import { mapWorkflowToDetail } from '../../workflow/workflow-dto.ts';
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

/** `GET /api/workflows/:id` — the workflow's projected detail (steps + edges), or 404. */
export function handleWorkflowDetail(id: string): Response {
  const def = getWorkflow(id);
  if (!def) return json({ error: 'not found' }, 404);
  return json(mapWorkflowToDetail(def), 200);
}
