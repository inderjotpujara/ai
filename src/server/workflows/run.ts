import { getWorkflow } from '../../../workflows/index.ts';
import {
  RunLaunchResponseSchema,
  WorkflowRunRequestSchema,
} from '../../contracts/index.ts';
import { explain } from '../../errors/boundary.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun, writeArtifact } from '../../run/run-store.ts';
import type { WorkflowDef } from '../../workflow/types.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type RunWorkflowTurn = (input: {
  def: WorkflowDef;
  input: string;
  runId: string;
}) => Promise<unknown>;

export type WorkflowRunDeps = {
  runsRoot: string;
  runWorkflowTurn: RunWorkflowTurn;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/** `POST /api/workflows/:id/run` — fire-and-watch (see handleCrewRun for the contract). */
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
  const run = await createRun(deps.runsRoot, runId);
  void deps
    .runWorkflowTurn({ def, input, runId })
    .catch(async (err: unknown) => {
      try {
        await writeArtifact(
          run,
          'error.json',
          JSON.stringify({ error: explain(err).title }),
        );
      } catch {
        // best-effort
      }
    });
  return json(RunLaunchResponseSchema.parse({ runId }), 200);
}
