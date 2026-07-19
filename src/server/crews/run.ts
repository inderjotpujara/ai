import { getCrew } from '../../../crews/index.ts';
import {
  CrewRunRequestSchema,
  RunLaunchResponseSchema,
} from '../../contracts/index.ts';
import type { CrewDef } from '../../crew/types.ts';
import type { JobStore } from '../../queue/store.ts';
import { JobKind } from '../../queue/types.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun } from '../../run/run-store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

/** Runs a crew to completion under its own `withMcpRun` scope. No longer called
 *  by the route — the worker pool's dispatch (`server/jobs/dispatch.ts`) invokes
 *  it for a `JobKind.Crew` job, with the job's pre-minted `runId` and the pool's
 *  `AbortSignal`. Its rejection is captured by the pool as the job's terminal
 *  `Failed`. Implementations MUST be `async` (always return a Promise). */
export type RunCrewTurn = (input: {
  def: CrewDef;
  input: string;
  runId: string;
}) => Promise<unknown>;

export type CrewRunDeps = { runsRoot: string; jobStore: JobStore };

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
 * `/api/runs/:id/stream` never 404s), ENQUEUES a durable `JobKind.Crew` job
 * (executed by the worker pool, so it survives restart and is cancellable via
 * `/api/jobs/:id/cancel`), and returns the runId at once. `job.runId` IS the run
 * dir id, so the stream the browser opens resolves to the pool-run's journal.
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
  await createRun(deps.runsRoot, runId);
  deps.jobStore.enqueue({
    kind: JobKind.Crew,
    payload: { name, input },
    runId,
  });
  return json(RunLaunchResponseSchema.parse({ runId }), 200);
}
