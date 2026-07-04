import { judgeMinParams } from './config.ts';

/** Thrown when the `selectJudge`-chosen judge model cannot be resolved/loaded
 *  (e.g. the runtime can't fit it in the live memory budget even after LRU
 *  eviction). The builders' `goldenEval` catches this and degrades to skipping
 *  behavioral eval (commit at `VerifiedLevel.Runs`) rather than crashing the
 *  build — the repo's standing "never crash, always degrade" policy. Degrading
 *  by grading on the GENERATOR model is deliberately NOT done (that would
 *  reintroduce the self-grading the cross-family judge exists to prevent). */
export class JudgeUnavailableError extends Error {
  constructor(readonly modelId: string) {
    super(`judge model unavailable: ${modelId}`);
    this.name = 'JudgeUnavailableError';
  }
}

export type JudgeCandidate = { model: string; params: number; family: string };

export type JudgeDeps = {
  candidates: () => JudgeCandidate[];
  generatorFamily?: string;
};

export type JudgePick = { model: string | null; belowBar: boolean };

/** Pick a judge model: must clear the parameter bar; prefer a family
 *  different from the generator's, then the largest. Degrades (belowBar)
 *  instead of throwing when nothing qualifies. */
export function selectJudge(deps: JudgeDeps): JudgePick {
  const qualifying = deps
    .candidates()
    .filter((c) => c.params >= judgeMinParams());
  const sorted = [...qualifying].sort((a, b) => {
    const aSameFamily = a.family === deps.generatorFamily ? 1 : 0;
    const bSameFamily = b.family === deps.generatorFamily ? 1 : 0;
    if (aSameFamily !== bSameFamily) return aSameFamily - bSameFamily;
    return b.params - a.params;
  });
  const head = sorted[0];
  if (!head) return { model: null, belowBar: true };
  return { model: head.model, belowBar: false };
}
