import { getCrew } from '../../../crews/index.ts';
import {
  CrewRunRequestSchema,
  RunLaunchResponseSchema,
} from '../../contracts/index.ts';
import type { CrewDef } from '../../crew/types.ts';
import { explain } from '../../errors/boundary.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun, writeArtifact } from '../../run/run-store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/** Starts a crew run to completion under its own `withMcpRun` scope. Detached by
 *  the handler; may reject (its rejection is caught + persisted to error.json). */
export type RunCrewTurn = (input: {
  def: CrewDef;
  input: string;
  runId: string;
}) => Promise<unknown>;

export type CrewRunDeps = { runsRoot: string; runCrewTurn: RunCrewTurn };

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
 * `POST /api/crews/:name/run` — fire-and-watch. Validates the body, looks up the
 * crew, mints a runId, PRE-CREATES the run dir (so the browser's immediate
 * `/api/runs/:id/stream` never 404s), starts the run DETACHED, and returns the
 * runId at once. A throw in the detached run is caught + written to error.json.
 */
export async function handleCrewRun(
  req: Request,
  deps: CrewRunDeps,
  name: string,
): Promise<Response> {
  const def = getCrew(name);
  if (!def) return json({ error: 'not found' }, 404);
  let input: string;
  try {
    input = CrewRunRequestSchema.parse(await req.json()).input;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const runId = newRunId();
  const run = await createRun(deps.runsRoot, runId);
  void deps.runCrewTurn({ def, input, runId }).catch(async (err: unknown) => {
    try {
      await writeArtifact(
        run,
        'error.json',
        JSON.stringify({ error: explain(err).title }),
      );
    } catch {
      // best-effort: the run dir may already be gone; nothing else to do.
    }
  });
  return json(RunLaunchResponseSchema.parse({ runId }), 200);
}
