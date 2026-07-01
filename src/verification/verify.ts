import { withVerificationSpan } from '../telemetry/spans.ts';
import { decomposeClaims } from './claims.ts';
import { verifyModel, verifyThreshold } from './config.ts';
import { verifyFaithfulness } from './judge.ts';
import type { Verdict, VerifyDeps } from './types.ts';

/**
 * Top-level grounded-verification primitive: decompose the answer into
 * claims, fetch the evidence each claim cites, resolve the judge model, and
 * grade faithfulness against a threshold. Wrapped in a verification.check
 * telemetry span so the verdict is observable.
 */
export async function verify(
  answer: string,
  opts: { query: string; space: string; threshold?: number },
  deps: VerifyDeps,
): Promise<Verdict> {
  const threshold = opts.threshold ?? verifyThreshold();
  const claims = await decomposeClaims(answer, deps);
  const allIds = [...new Set(claims.flatMap((c) => c.citedIds))];
  const evidence = allIds.length ? await deps.getByIds(opts.space, allIds) : [];
  const evidenceById = new Map(evidence.map((e) => [e.id, e.text]));
  // The judge model is the configured verify model (not the general/router
  // model) — `deps.generalModel` stays reserved for decompose/grade and as
  // the fallback judge inside verifyFaithfulness.
  const judge = await deps.ensureJudge(verifyModel());
  return withVerificationSpan({}, async () => {
    const verdict = await verifyFaithfulness(
      claims,
      evidenceById,
      judge.model,
      judge.fallback,
      threshold,
      deps,
    );
    return verdict;
  });
}
