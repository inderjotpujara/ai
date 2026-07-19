import {
  JobEnqueueRequestSchema,
  JobKindWire,
  JobLaunchResponseSchema,
  ModelPullRequestSchema,
} from '../../contracts/index.ts';
import type { ProviderKind, RuntimeKind } from '../../core/types.ts';
import { recordJobEnqueue } from '../../daemon/spans.ts';
import { readCatalog } from '../../discovery/catalog-cache.ts';
import type { JobStore } from '../../queue/store.ts';
import type { JobKind, JobPriority } from '../../queue/types.ts';
import { newRunId } from '../../run/run-id.ts';
import { createRun } from '../../run/run-store.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { ALWAYS_ALLOW } from '../run-rate.ts';

export type JobEnqueueDeps = {
  jobStore: JobStore;
  runsRoot: string;
  /** Injectable for tests; the real server wires the cached-catalog lookup
   *  (`defaultResolveProvider` below), mirroring `ModelPullDeps.resolveProvider`
   *  (`src/server/models/pull.ts`) — a pull job's `provider` is NEVER trusted
   *  from the client, always resolved here server-side. */
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
 *  from the SAME cached catalog `GET /api/models` ranked its pullable rows
 *  from — never trusts a client-supplied `provider` (byte-for-byte the same
 *  lookup `handleModelPull` performs, `src/server/models/pull.ts:43`). */
function defaultResolveProvider(
  runtime: RuntimeKind,
  modelRef: string,
): ProviderKind | undefined {
  return (readCatalog() ?? []).find(
    (c) => c.runtime === runtime && c.model === modelRef,
  )?.provider;
}

/**
 * `POST /api/jobs` — enqueue a durable job (Slice 24 Incr 3). Validates the
 * envelope; for `kind=pull`, resolves the `ProviderKind` SERVER-SIDE from the
 * model catalog (a client-supplied `provider` field, if any, is ignored) and
 * embeds the resolved value into the PERSISTED payload so
 * `dispatch.ts`'s `PullJobPayloadSchema` — which requires `provider` — is
 * satisfied without dispatch ever re-resolving or trusting the client for it.
 * Pre-mints the `runId` and pre-creates its run dir (mirroring
 * `handleCrewRun`) so an immediate `/api/runs/:runId/stream` never 404s, then
 * enqueues and returns `202 {jobId, runId}`.
 */
export async function handleJobEnqueue(
  req: Request,
  deps: JobEnqueueDeps,
): Promise<Response> {
  let body: ReturnType<typeof JobEnqueueRequestSchema.parse>;
  try {
    body = JobEnqueueRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  let payload = body.payload;
  if (body.kind === JobKindWire.Pull) {
    let pull: ReturnType<typeof ModelPullRequestSchema.parse>;
    try {
      pull = ModelPullRequestSchema.parse(payload);
    } catch {
      return json({ error: 'bad request' }, 400);
    }
    const resolveProvider = deps.resolveProvider ?? defaultResolveProvider;
    const provider = resolveProvider(pull.runtime, pull.modelRef);
    if (!provider) return json({ error: 'unknown model' }, 404);
    payload = { ...pull, provider };
  }

  const limiter = deps.runLimiter ?? ALWAYS_ALLOW;
  if (!limiter.allow()) return json({ error: 'rate limited' }, 429);

  // Resume path (Task 41): re-enqueue an EXISTING run instead of minting a
  // fresh one. The run dir (and its checkpoint.json) already exist, so we do
  // NOT createRun; dispatch runs the crew/workflow turn against this runId and
  // the engine's per-node checkpoint skips already-completed nodes. A
  // `resumeRunId` marker is stamped into the persisted payload so dispatch can
  // recognise a resumed run without re-deriving it.
  let runId: string;
  if (body.resume) {
    runId = body.resume;
    payload = { ...(payload as Record<string, unknown>), resumeRunId: runId };
  } else {
    runId = newRunId();
    await createRun(deps.runsRoot, runId);
  }
  const job = deps.jobStore.enqueue({
    // JobKindWire/JobPriorityWire (wire) <-> JobKind/JobPriority (queue) are
    // isomorphic string enums guarded by job-kind-parity.test.ts; distinct
    // nominal enum types otherwise reject a direct assignment (same idiom as
    // `crew-dto.ts`/`workflow-dto.ts`'s wire<->domain enum casts).
    kind: body.kind as unknown as JobKind,
    payload,
    priority: body.priority as unknown as JobPriority | undefined,
    runId,
  });
  recordJobEnqueue(job);
  return json(JobLaunchResponseSchema.parse({ jobId: job.id, runId }), 202);
}
