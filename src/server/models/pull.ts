import {
  ModelPullRequestSchema,
  RunLaunchResponseSchema,
} from '../../contracts/index.ts';
import type { ProviderKind, RuntimeKind } from '../../core/types.ts';
import { readCatalog } from '../../discovery/catalog-cache.ts';
import type { JobStore } from '../../queue/store.ts';
import { JobKind } from '../../queue/types.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun } from '../../run/run-store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { ALWAYS_ALLOW } from '../run-rate.ts';

/** Downloads a model's weights to completion. No longer called by the route —
 *  the worker pool's dispatch invokes it for a `JobKind.Pull` job, reading the
 *  `provider` the route resolved server-side and persisted into the payload. */
export type RunModelPullTurn = (input: {
  runtime: RuntimeKind;
  provider: ProviderKind;
  modelRef: string;
  runId: string;
}) => Promise<void>;

export type ModelPullDeps = {
  runsRoot: string;
  jobStore: JobStore;
  /** Injectable for tests; the real server wires the cached-catalog lookup
   *  below. Never trusts a client-supplied provider (D2/§4.2 item 4). */
  resolveProvider?: (
    runtime: RuntimeKind,
    modelRef: string,
  ) => ProviderKind | undefined;
  /** Gates run-dir creation against a client (now potentially remote)
   *  spamming enqueue/launch (Slice 24 Incr 5, item 2). The real server
   *  injects the process-shared limiter (`server/run-rate.ts
   *  createProcessRunLimiter`, wired in `ServerDeps` by `main.ts`); absent
   *  (most unit tests) falls back to `ALWAYS_ALLOW`. */
  runLimiter?: { allow(): boolean };
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
 * `ProviderKind` SERVER-SIDE (never client-trusted), mint a runId, PRE-CREATE
 * the run dir, then ENQUEUE a durable `JobKind.Pull` job whose payload embeds
 * the resolved provider (so dispatch never re-resolves or trusts the client),
 * and return `{ runId }` at once. The worker pool executes the pull, so it
 * survives restart and is cancellable via `/api/jobs/:id/cancel`. The browser
 * opens the EXISTING `/api/runs/:runId/stream` — no new stream code (D2).
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

  const limiter = deps.runLimiter ?? ALWAYS_ALLOW;
  if (!limiter.allow()) return json({ error: 'rate limited' }, 429);

  const runId = newRunId();
  await createRun(deps.runsRoot, runId);
  deps.jobStore.enqueue({
    kind: JobKind.Pull,
    payload: { runtime: body.runtime, modelRef: body.modelRef, provider },
    runId,
  });
  return json(RunLaunchResponseSchema.parse({ runId }), 200);
}
