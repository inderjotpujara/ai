import {
  EvalReevalRequestSchema,
  EvalReevalResponseSchema,
} from '../../contracts/evals.ts';
import type { JobStore } from '../../queue/store.ts';
import { JobKind } from '../../queue/types.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { EvalMode } from '../jobs/dispatch.ts';
import type { OriginPolicy } from '../security/origin.ts';
import type { SessionGuard } from '../security/token.ts';
import { requireTrustedLocal } from '../security/trusted-local.ts';

export type EvalReevalDeps = {
  jobStore: Pick<JobStore, 'enqueue'>;
  policy: OriginPolicy;
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

/**
 * `POST /api/evals/reeval` — the "re-eval now" button (Task 20). A MUTATING
 * write (enqueues a durable job) → behind `requireTrustedLocal` FIRST, the
 * same privileged-local posture as `handleTriggerCreate`/`handleDevicePair`: a
 * rejected caller leaves ZERO side effect, nothing parsed or enqueued.
 *
 * `mode:'artifact'` enqueues ONE `JobKind.Eval` job with payload
 * `{mode: EvalMode.Artifact, ref, reason:'manual'}`; `mode:'all'` enqueues ONE
 * with `{mode: EvalMode.Sweep, reason:'manual'}` — exactly the shape
 * `dispatch.ts`'s `EvalJobPayloadSchema` (and `createRealRunEvalTurn`) already
 * know how to run, so no new dispatch wiring is needed here.
 */
export async function handleEvalReeval(
  req: Request,
  deps: EvalReevalDeps,
  guard: SessionGuard,
): Promise<Response> {
  const forbidden = requireTrustedLocal(req, guard, deps.policy);
  if (forbidden) return forbidden;

  let body: ReturnType<typeof EvalReevalRequestSchema.parse>;
  try {
    body = EvalReevalRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const payload =
    body.mode === 'artifact'
      ? { mode: EvalMode.Artifact, ref: body.ref, reason: 'manual' }
      : { mode: EvalMode.Sweep, reason: 'manual' };

  const job = deps.jobStore.enqueue({ kind: JobKind.Eval, payload });
  return json(
    EvalReevalResponseSchema.parse({ enqueued: 1, jobIds: [job.id] }),
    202,
  );
}
