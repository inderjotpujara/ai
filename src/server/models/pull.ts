import {
  ModelPullRequestSchema,
  RunLaunchResponseSchema,
} from '../../contracts/index.ts';
import type { ProviderKind, RuntimeKind } from '../../core/types.ts';
import { readCatalog } from '../../discovery/catalog-cache.ts';
import { explain } from '../../errors/boundary.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun, writeArtifact } from '../../run/run-store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';

export type RunModelPullTurn = (input: {
  runtime: RuntimeKind;
  provider: ProviderKind;
  modelRef: string;
  runId: string;
}) => Promise<void>;

export type ModelPullDeps = {
  runsRoot: string;
  runModelPull: RunModelPullTurn;
  /** Injectable for tests; the real server wires the cached-catalog lookup
   *  below. Never trusts a client-supplied provider (D2/§4.2 item 4). */
  resolveProvider?: (
    runtime: RuntimeKind,
    modelRef: string,
  ) => ProviderKind | undefined;
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

/** Resolves which `DownloadProvider` fetches `(runtime, modelRef)`'s weights
 *  by re-checking the SAME cached catalog `GET /api/models` (Task 16) ranked
 *  its pullable rows from — never trusts a client-supplied provider. */
function defaultResolveProvider(
  runtime: RuntimeKind,
  modelRef: string,
): ProviderKind | undefined {
  return (readCatalog() ?? []).find(
    (c) => c.runtime === runtime && c.model === modelRef,
  )?.provider;
}

/**
 * `POST /api/models/pull` (spec §4.2.4) — fire-and-watch (D2), the exact
 * shape `handleCrewRun` established (Phase 4): validate, resolve the
 * `ProviderKind` server-side, mint a runId, PRE-CREATE the run dir, start the
 * pull DETACHED, return `{ runId }` at once. A throw in the detached pull is
 * caught + written to error.json. The browser opens the EXISTING
 * `/api/runs/:runId/stream` — no new stream code (D2).
 */
export async function handleModelPull(
  req: Request,
  deps: ModelPullDeps,
): Promise<Response> {
  let body: ReturnType<typeof ModelPullRequestSchema.parse>;
  try {
    body = ModelPullRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid pull request' }, 400);
  }
  const resolveProvider = deps.resolveProvider ?? defaultResolveProvider;
  const provider = resolveProvider(body.runtime, body.modelRef);
  if (!provider) return json({ error: 'unknown model' }, 404);

  const runId = newRunId();
  const run = await createRun(deps.runsRoot, runId);
  void deps
    .runModelPull({
      runtime: body.runtime,
      provider,
      modelRef: body.modelRef,
      runId,
    })
    .catch(async (err: unknown) => {
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
