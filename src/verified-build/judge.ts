import { judgeMinParams } from './config.ts';

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
