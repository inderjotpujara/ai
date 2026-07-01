import { recordVerdict, withVerificationSpan } from '../telemetry/spans.ts';
import { decomposeClaims, parseCitations } from './claims.ts';
import { verifyModel, verifyThreshold } from './config.ts';
import { verifyFaithfulness } from './judge.ts';
import type { Verdict, VerifyDeps } from './types.ts';

/**
 * Top-level grounded-verification primitive: decompose the answer into
 * claim texts, deterministically parse the answer's own [mem:<id>] citations
 * into a single evidence pool, resolve the judge model, and grade each
 * claim's faithfulness against that pool. Wrapped in a verification.check
 * telemetry span so the verdict is observable.
 *
 * Evidence is pooled (not per-claim) because the general/router model used
 * for claim decomposition is unreliable at recovering each claim's own
 * citation ids (it sometimes emits them with a stray `mem:` prefix, or drops
 * them entirely) — see the pooled-evidence fix in judge.ts. `parseCitations`
 * is a deterministic regex over the answer text and does not depend on the
 * LLM at all.
 */
export async function verify(
  answer: string,
  opts: { query: string; space: string; threshold?: number },
  deps: VerifyDeps,
): Promise<Verdict> {
  const threshold = opts.threshold ?? verifyThreshold();
  const claims = await decomposeClaims(answer, deps);
  const allIds = parseCitations(answer);
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
    // Annotate the verification.check span (opened above) with the verdict
    // computed here — deferred from Task 7 since the verdict didn't exist yet
    // when the span was seeded.
    recordVerdict(verdict.unsupportedClaims.length);
    return verdict;
  });
}
