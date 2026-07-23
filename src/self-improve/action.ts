/**
 * D5 — the ACTION a re-eval verdict triggers (Slice 32, §7.5). The pure
 * decision (`decideRegression`, D4) yields a `RegressionOutcome`; this module
 * turns that verdict into durable effects. It is deliberately a thin,
 * injected-deps orchestration (store + upsert seams passed in) so it stays
 * unit-testable with fakes and never couples to a live DB or manifest here.
 *
 * On EVERY verdict it appends one append-only `eval_history` row (the durable
 * record of the re-eval, per §7.4). ONLY a CONFIRMED `Regression` additionally
 * takes action, in this exact order:
 *   1. row already appended above;
 *   2. auto-demote `verifiedLevel` Behaves→Unverified — a read-modify-write via
 *      `upsertEntry`, which uses `atomicWrite` (no half-written manifest) and is
 *      IDEMPOTENT (an already-Unverified entry is the same safe re-write);
 *   3. `recordDegrade({ kind: ModelDegraded, from, to })` — the in-run degrade
 *      signal;
 *   4. `recordEvalRegression` — the `eval.regression` span event.
 * There is NO auto-repair, NO re-route, NO regeneration — a regression demotes
 * and surfaces; a human/rebuild path re-verifies later.
 *
 * Pass / WithinNoise / Inconclusive all record their row and return
 * `{ demoted: false }` — they NEVER demote, degrade, or emit `eval.regression`.
 *
 * NO secret/PII ever reaches the `eval.regression` span — artifact name, counts,
 * drop, and model ids only (`recordEvalRegression` enforces the same rule).
 */

import { randomUUID } from 'node:crypto';
import { DegradeKind } from '../reliability/ledger.ts';
import { recordDegrade } from '../telemetry/spans.ts';
import type { EvalResult, ManifestEntry } from '../verified-build/types.ts';
import { VerifiedLevel } from '../verified-build/types.ts';
import type { EvalHistoryRow, EvalHistoryStore } from './history.ts';
import { type RegressionOutcome, RegressionVerdict } from './regression.ts';
import { recordEvalRegression } from './spans.ts';

export type ApplyDeps = {
  history: EvalHistoryStore;
  upsertEntry: (dir: string, name: string, entry: ManifestEntry) => void;
  now?: () => number;
};

export type ApplyInput = {
  dir: string;
  name: string;
  entry: ManifestEntry;
  outcome: RegressionOutcome;
  result: EvalResult;
  currentModel: string;
  baselineModel?: string;
  reason?: string;
};

/**
 * Records the `eval_history` row for a completed re-eval and, on a CONFIRMED
 * regression, demotes Behaves→Unverified (idempotent), records a ModelDegraded
 * degrade, and emits `eval.regression`. Returns whether it demoted.
 */
export function applyRegressionOutcome(
  input: ApplyInput,
  deps: ApplyDeps,
): { demoted: boolean } {
  const { dir, name, entry, outcome, result, currentModel } = input;
  const { baselineModel, reason } = input;
  const now = deps.now ?? Date.now;
  const regressed = outcome.verdict === RegressionVerdict.Regression;

  // (1) ALWAYS append the durable row — every verdict is a historical fact.
  const row: EvalHistoryRow = {
    id: randomUUID(),
    artifactId: name,
    model: currentModel,
    baselineModel,
    ts: now(),
    passed: result.passed,
    passedCount: result.passedCount,
    total: result.total,
    regressed,
    perCase: result.perCase,
    judgeModel: result.judgeModel,
    belowBar: result.belowBar,
    reason,
  };
  deps.history.insert(row);

  // Pass / WithinNoise / Inconclusive: row recorded, no demote, no degrade.
  if (!regressed) return { demoted: false };

  // (2) Auto-demote Behaves→Unverified — atomic + idempotent via upsertEntry.
  deps.upsertEntry(dir, name, {
    ...entry,
    verifiedLevel: VerifiedLevel.Unverified,
    lastEvalPass: false,
  });

  // (3) In-run degrade signal (from → to model).
  recordDegrade({
    kind: DegradeKind.ModelDegraded,
    subject: name,
    reason: 'golden re-eval regression on model swap',
    from: baselineModel ?? '',
    to: currentModel,
  });

  // (4) `eval.regression` span event — counts/drop/model ids only, no PII.
  recordEvalRegression({
    artifact: name,
    regressedCount: outcome.regressedCaseIds.length,
    drop: outcome.drop,
    from: baselineModel ?? '',
    to: currentModel,
  });

  return { demoted: true };
}
