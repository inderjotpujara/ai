import { checkClaim } from '../verification/judge.ts';
import type { VerifyDeps } from '../verification/types.ts';
import { evalRuns } from './config.ts';
import type { JudgeCandidate } from './judge.ts';
import { JudgeUnavailableError, selectJudge } from './judge.ts';
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

/** The runtime seams a `runGoldenEval` pass binds over. The `runCase` and
 *  `judge` closures carry each caller's own execution/grading transport
 *  (agent vs crew/workflow run, judge argument order) so the shared binding
 *  itself stays transport-agnostic. */
export type GoldenEvalBinding = {
  cases: GoldenCase[];
  judgeCandidates: () => JudgeCandidate[];
  generatorFamily?: string;
  runCase: (input: string) => Promise<string>;
  judge: (model: string, prompt: string) => Promise<boolean>;
};

/** The ONE eval-binding path shared by both builders' `goldenEval` closures
 *  AND the re-eval engine: select the judge (below-bar → null, so no eval is
 *  paid for when nothing can grade), bind `EvalDeps` around the caller's
 *  transport, and run `evalCases`. A `JudgeUnavailableError` degrades to null
 *  (skip behavioral eval), matching the gate's never-crash policy — a judge
 *  model that can't be loaded commits at `VerifiedLevel.Runs` rather than
 *  crashing the build. Any other error propagates unchanged. */
export async function runGoldenEval(
  b: GoldenEvalBinding,
): Promise<EvalResult | null> {
  const judgePick = selectJudge({
    candidates: b.judgeCandidates,
    generatorFamily: b.generatorFamily,
  });
  if (judgePick.model === null) return null;
  const judgeModelId = judgePick.model;
  try {
    return await evalCases(b.cases, {
      runCase: b.runCase,
      // Bind the SELECTED judge model id into every judge call (C3): the
      // judge must run on the model selectJudge picked, not the generator.
      judge: (prompt) => b.judge(judgeModelId, prompt),
      judgeModel: judgeModelId,
      belowBar: judgePick.belowBar,
    });
  } catch (err) {
    if (err instanceof JudgeUnavailableError) return null;
    throw err;
  }
}
