import { evalRuns } from './config.ts';
import type { EvalCaseResult, EvalResult, GoldenCase } from './types.ts';

export type EvalDeps = {
  runCase: (input: string) => Promise<string>;
  judge: (prompt: string) => Promise<boolean>;
  judgeModel: string;
  belowBar: boolean;
};

function rubricPrompt(assert: string, output: string): string {
  return `Does this output satisfy the requirement?\nRequirement: ${assert}\nOutput:\n${output}\nAnswer only Yes or No.`;
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
    const prompt = rubricPrompt(c.assert, output);
    let casePassed = true;
    for (let i = 0; i < runs; i++) {
      const yes = await deps.judge(prompt);
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
