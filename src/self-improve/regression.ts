/**
 * D4 — the noise-band regression DECISION (Slice 32, §7.1). The correctness
 * core of the self-improvement loop: given a baseline `EvalResult` (the entry's
 * last-passing eval) and a fresh one from `reevalArtifact`, decide whether the
 * fresh run is a REAL regression, within-noise, or inconclusive.
 *
 * `decideRegression` is a PURE decision function. It NEVER demotes, writes
 * history, or records telemetry — D5 (Task 14) owns all actions. The only
 * effect it has is calling the INJECTED `rerun` seam (bounded extra re-runs of
 * the regressed cases on the SAME resolved model + judge), so it stays
 * unit-testable with a fake and never couples to a live model here.
 *
 * The noise-robustness comes from two layers, both mirroring `evalCases`'
 * unanimous-Yes-to-pass rule:
 *   1. Per-CASE detection (not aggregate): a case regressed iff it PASSED at
 *      baseline and FAILS now. An aggregate pass-rate can stay flat while one
 *      case silently flips true→false and another flips the other way — the
 *      per-case predicate catches the silent flip; an improvement elsewhere
 *      never offsets a regression.
 *   2. Bounded unanimous-fail confirmation: each regressed case is re-run K
 *      more times; it is CONFIRMED-regressed only if it fails on EVERY re-run
 *      (unanimous fail). A case that recovers on ANY re-run is judge noise and
 *      is dropped from the confirmed set.
 * Then a hysteresis band: the aggregate drop over the CONFIRMED set must
 * strictly EXCEED H before it is a real regression (`drop === H` is NOT).
 *
 * A below-bar judge at eval time → Inconclusive: nothing could be graded, so
 * there is no verdict to diff — never a demote.
 */

import type { EvalResult } from '../verified-build/types.ts';

/** The four terminal verdicts. Only `Regression` authorizes a demote (by D5);
 *  the other three are all "do not demote". */
export enum RegressionVerdict {
  /** No case regressed at all — fresh held every case the baseline passed. */
  Pass = 'pass',
  /** Confirmed-regressed cases whose aggregate drop strictly exceeds H. */
  Regression = 'regression',
  /** Cases flipped but recovered on re-run, or the confirmed drop is within
   *  the hysteresis band — judge noise, not a real regression. */
  WithinNoise = 'within-noise',
  /** Judge below bar at eval time — nothing gradeable, no verdict. */
  Inconclusive = 'inconclusive',
}

export type RegressionInput = {
  baseline: EvalResult;
  fresh: EvalResult;
  /** H (AGENT_REEVAL_HYSTERESIS) — the aggregate drop margin a confirmed
   *  regression must strictly EXCEED. */
  hysteresis: number;
  /** K (AGENT_REEVAL_RERUN_CASES) — extra re-runs per regressed case. */
  rerunCases: number;
  /** Re-run ONLY these case ids `count` extra times each on the SAME resolved
   *  model + judge; returns per-case pass/fail across the `count` runs. */
  rerun: (
    caseIds: string[],
    count: number,
  ) => Promise<Record<string, boolean[]>>;
};

export type RegressionOutcome = {
  verdict: RegressionVerdict;
  /** The confirmed-regressed case ids (unanimous fail across re-runs). */
  regressedCaseIds: string[];
  /** Aggregate pass-rate drop over the confirmed set = confirmed / total. */
  drop: number;
};

export async function decideRegression(
  input: RegressionInput,
): Promise<RegressionOutcome> {
  const { baseline, fresh, hysteresis, rerunCases, rerun } = input;

  // 1. Judge below bar at eval time → nothing gradeable. Never a demote.
  if (fresh.belowBar) {
    return {
      verdict: RegressionVerdict.Inconclusive,
      regressedCaseIds: [],
      drop: 0,
    };
  }

  // 2. Per-CASE regressed set, keyed on each case's OWN baseline verdict:
  //    passed at baseline AND fails now. (Not the aggregate pass-rate.)
  const baselinePassed = new Map(baseline.perCase.map((c) => [c.id, c.passed]));
  const regressed = fresh.perCase.filter(
    (c) => baselinePassed.get(c.id) === true && c.passed === false,
  );
  if (regressed.length === 0) {
    return { verdict: RegressionVerdict.Pass, regressedCaseIds: [], drop: 0 };
  }

  // 3. Bounded unanimous-fail confirmation: re-run each regressed case K more
  //    times; CONFIRMED only if it fails on EVERY re-run. A case that recovers
  //    on any re-run (or has no re-run record) is dropped as noise.
  const rr = await rerun(
    regressed.map((c) => c.id),
    rerunCases,
  );
  const confirmed = regressed.filter((c) => {
    const runs = rr[c.id];
    return (
      Array.isArray(runs) && runs.length > 0 && runs.every((passed) => !passed)
    );
  });
  const regressedCaseIds = confirmed.map((c) => c.id);

  // 4. Aggregate drop over the confirmed set.
  const drop = confirmed.length / baseline.total;

  // 5. Real regression iff ≥1 confirmed AND drop STRICTLY exceeds H.
  //    `drop === H` is within-noise (strict `>`). Neither branch demotes —
  //    that is D5's job on a `Regression` verdict.
  const real = confirmed.length >= 1 && drop > hysteresis;
  return {
    verdict: real
      ? RegressionVerdict.Regression
      : RegressionVerdict.WithinNoise,
    regressedCaseIds,
    drop,
  };
}
