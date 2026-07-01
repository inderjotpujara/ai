import type { Claim, ClaimVerdict, Verdict, VerifyDeps } from './types.ts';

/** MiniCheck-style call: (document, claim) → Yes/No. Fallback uses the same shape on the general model. */
export async function checkClaim(
  claim: string,
  evidence: string,
  judgeModel: string,
  deps: VerifyDeps,
): Promise<boolean> {
  if (!evidence.trim()) return false;
  const prompt = `Document:\n${evidence}\n\nClaim: ${claim}\n\nIs the claim fully supported by the document? Answer only "Yes" or "No".`;
  const raw = (await deps.generate(judgeModel, prompt)).trim().toLowerCase();
  return raw.startsWith('yes');
}

/**
 * Judges each decomposed claim against a single pooled-evidence string built
 * from the ANSWER's own deterministically-parsed [mem:<id>] citations (see
 * verify.ts) — not per-claim `citedIds` recovered by the LLM decomposer.
 * The general model is unreliable at recovering a claim's own citation ids
 * (it sometimes returns them with a stray `mem:` prefix, so `getByIds` finds
 * nothing, or omits them inconsistently), which was previously causing
 * genuinely-grounded answers to be marked unsupported. Pooling sidesteps
 * that: every claim is checked against everything the answer actually cited.
 */
export async function verifyFaithfulness(
  claims: Claim[],
  evidenceById: Map<string, string>,
  judgeModel: string,
  fallback: boolean,
  threshold: number,
  deps: VerifyDeps,
): Promise<Verdict> {
  const pooledEvidence = [...evidenceById.values()].join('\n\n');
  const pooledIds = [...evidenceById.keys()];
  const verdicts: ClaimVerdict[] = [];
  for (const c of claims) {
    if (!pooledEvidence.trim()) {
      verdicts.push({
        claim: c.text,
        citedIds: pooledIds,
        supported: false,
        reason: 'no citation',
      });
      continue;
    }
    const supported = await checkClaim(
      c.text,
      pooledEvidence,
      judgeModel,
      deps,
    );
    verdicts.push({
      claim: c.text,
      citedIds: pooledIds,
      supported,
      reason: supported ? undefined : 'unsupported by cited evidence',
    });
  }
  const total = verdicts.length || 1;
  const supportedCount = verdicts.filter((v) => v.supported).length;
  const faithfulness = supportedCount / total;
  return {
    supported: faithfulness >= threshold,
    faithfulness,
    claims: verdicts,
    unsupportedClaims: verdicts.filter((v) => !v.supported).map((v) => v.claim),
    usedFallback: fallback,
  };
}
