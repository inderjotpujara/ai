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

export async function verifyFaithfulness(
  claims: Claim[],
  evidenceById: Map<string, string>,
  judgeModel: string,
  fallback: boolean,
  threshold: number,
  deps: VerifyDeps,
): Promise<Verdict> {
  const verdicts: ClaimVerdict[] = [];
  for (const c of claims) {
    if (c.citedIds.length === 0) {
      verdicts.push({
        claim: c.text,
        citedIds: [],
        supported: false,
        reason: 'no citation',
      });
      continue;
    }
    const evidence = c.citedIds
      .map((id) => evidenceById.get(id) ?? '')
      .filter(Boolean)
      .join('\n\n');
    const supported = await checkClaim(c.text, evidence, judgeModel, deps);
    verdicts.push({
      claim: c.text,
      citedIds: c.citedIds,
      supported,
      reason: supported
        ? undefined
        : evidence
          ? 'unsupported by cited evidence'
          : 'cited chunk missing',
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
