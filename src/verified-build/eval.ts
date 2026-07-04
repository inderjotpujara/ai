import { checkClaim } from '../verification/judge.ts';
import type { VerifyDeps } from '../verification/types.ts';
import { evalRuns } from './config.ts';
import type { EvalCaseResult, EvalResult, GoldenCase } from './types.ts';
import { GoldenKind } from './types.ts';

export type EvalDeps = {
  runCase: (input: string) => Promise<string>;
  judge: (prompt: string) => Promise<boolean>;
  judgeModel: string;
  belowBar: boolean;
};

function rubricPrompt(assert: string, output: string): string {
  return `Does this output satisfy the requirement?\nRequirement: ${assert}\nOutput:\n${output}\nAnswer only Yes or No.`;
}

/** Adapt this module's boolean judge seam to `checkClaim`'s `VerifyDeps`
 *  surface. Only `generate` is exercised by `checkClaim`; the remaining
 *  fields are inert placeholders to satisfy the type. The judge itself still
 *  runs on the selected judge model (C3) — this only reshapes the call. */
function claimCheckDeps(deps: EvalDeps): VerifyDeps {
  return {
    generate: async (_model, prompt) =>
      (await deps.judge(prompt)) ? 'Yes' : 'No',
    getByIds: async () => [],
    ensureJudge: async (model) => ({ model, fallback: false }),
    generalModel: deps.judgeModel,
  };
}

/** One yes/no verdict for a case. `Grounded` cases go through the shared
 *  MiniCheck-style `checkClaim` (assert = claim, artifact output = document)
 *  — the same grounding primitive the verification subsystem uses, including
 *  its empty-evidence auto-fail (F6). Every other kind keeps the generic
 *  requirement rubric. */
async function judgeOnce(
  c: GoldenCase,
  output: string,
  deps: EvalDeps,
): Promise<boolean> {
  if (c.kind === GoldenKind.Grounded) {
    return checkClaim(c.assert, output, deps.judgeModel, claimCheckDeps(deps));
  }
  return deps.judge(rubricPrompt(c.assert, output));
}

/** Run every golden case and judge each output evalRuns() times.
 *  A case passes only on a unanimous Yes (short-circuits on the first No). */
export async function evalCases(
  cases: GoldenCase[],
  deps: EvalDeps,
): Promise<EvalResult> {
  const runs = evalRuns();
  const perCase: EvalCaseResult[] = [];
  for (const c of cases) {
    const output = await deps.runCase(c.input);
    let casePassed = true;
    for (let i = 0; i < runs; i++) {
      const yes = await judgeOnce(c, output, deps);
      if (!yes) {
        casePassed = false;
        break;
      }
    }
    perCase.push({
      id: c.id,
      passed: casePassed,
      detail: casePassed
        ? `unanimous yes over ${runs} judge runs`
        : 'judge answered no',
    });
  }
  const passedCount = perCase.filter((r) => r.passed).length;
  return {
    passed: passedCount === cases.length,
    total: cases.length,
    passedCount,
    perCase,
    judgeModel: deps.judgeModel,
    belowBar: deps.belowBar,
  };
}
