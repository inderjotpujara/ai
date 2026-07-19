import { getWorkflow } from '../../../workflows/index.ts';
import {
  RunLaunchResponseSchema,
  WorkflowRunRequestSchema,
} from '../../contracts/index.ts';
import type { JobStore } from '../../queue/store.ts';
import { JobKind } from '../../queue/types.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun } from '../../run/run-store.ts';
import type { WorkflowDef } from '../../workflow/types.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/** Runs a workflow to completion (see `RunCrewTurn` in `server/crews/run.ts` for
 *  the full contract). No longer called by the route — the worker pool's
 *  dispatch invokes it for a `JobKind.Workflow` job. Implementations MUST be
 *  `async` (always return a Promise). */
export type RunWorkflowTurn = (input: {
  def: WorkflowDef;
  input: string;
  runId: string;
}) => Promise<unknown>;

export type WorkflowRunDeps = { runsRoot: string; jobStore: JobStore };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `POST /api/workflows/:id/run` — fire-and-watch (see handleCrewRun for the
 *  contract). Enqueues a durable `JobKind.Workflow` job (the pool executes it),
 *  keeping the same `{ runId }` response shape. */
export async function handleWorkflowRun(
  req: Request,
  deps: WorkflowRunDeps,
  id: string,
): Promise<Response> {
  const def = getWorkflow(id);
  if (!def) return json({ error: 'not found' }, 404);
  let input: string;
  try {
    input = WorkflowRunRequestSchema.parse(await req.json()).input;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const runId = newRunId();
  await createRun(deps.runsRoot, runId);
  deps.jobStore.enqueue({
    kind: JobKind.Workflow,
    payload: { name: id, input },
    runId,
  });
  return json(RunLaunchResponseSchema.parse({ runId }), 200);
}
