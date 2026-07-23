/**
 * Continuous re-eval telemetry (Slice 32, Task 3 — foundation only; the
 * detection/regression engine lands in later tasks). Reuses
 * `telemetry/spans.ts`'s `inSpan`/`ATTR` — no parallel span-emission path —
 * exactly like `daemon/spans.ts`'s `withJobRunSpan`. `withEvalReevalSpan`
 * opens the `eval.reeval` ROOT span (so `deriveRunKind` classifies this run
 * as an eval) via `inSpan`, which is a no-op (non-recording span) when no
 * tracer provider is registered — the wrapped `fn` still runs and its return
 * value still propagates. `recordEvalRegression` instead adds an event on
 * the ALREADY-ACTIVE span (mirrors `recordDegrade`/`recordEvict`): with no
 * active span it returns immediately, doing nothing.
 *
 * `mode` is a bare `string` for now (Task 3) — `EvalMode` doesn't exist
 * until Task 8/16, whose callers pass its string values here.
 *
 * NEVER put a secret/PII value on these spans — model ids and artifact
 * names only.
 */

import { trace } from '@opentelemetry/api';
import { ATTR, inSpan } from '../telemetry/spans.ts';

export type EvalReevalSpanInfo = {
  artifact: string;
  mode: string;
  baselineModel?: string;
  currentModel: string;
};

/** Root span for one re-eval pass over a single artifact's golden set. */
export function withEvalReevalSpan<T>(
  info: EvalReevalSpanInfo,
  fn: (rec: {
    golden: (passed: number, total: number) => void;
    judge: (model: string, belowBar: boolean) => void;
    outcome: (o: string) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('eval.reeval', async (span) => {
    span.setAttribute(ATTR.EVAL_ARTIFACT, info.artifact);
    span.setAttribute(ATTR.EVAL_MODE, info.mode);
    if (info.baselineModel !== undefined) {
      span.setAttribute(ATTR.EVAL_BASELINE_MODEL, info.baselineModel);
    }
    span.setAttribute(ATTR.EVAL_CURRENT_MODEL, info.currentModel);
    span.setAttribute(ATTR.MODEL_ID, info.currentModel);
    return fn({
      golden: (passed, total) => {
        span.setAttribute(ATTR.VERIFY_GOLDEN_PASSED, passed);
        span.setAttribute(ATTR.VERIFY_GOLDEN_TOTAL, total);
      },
      judge: (model, belowBar) => {
        span.setAttribute(ATTR.VERIFY_JUDGE_MODEL, model);
        span.setAttribute(ATTR.VERIFY_JUDGE_BELOW_BAR, belowBar);
      },
      outcome: (o) => {
        span.setAttribute(ATTR.EVAL_OUTCOME, o);
      },
    });
  });
}

/** Record a confirmed regression on the active span (mirrors
 *  `recordDegrade`/`recordEvict` — a no-op with no active span). */
export function recordEvalRegression(info: {
  artifact: string;
  regressedCount: number;
  drop: number;
  from: string;
  to: string;
}): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('eval.regression', {
    [ATTR.EVAL_ARTIFACT]: info.artifact,
    [ATTR.EVAL_REGRESSED_COUNT]: info.regressedCount,
    [ATTR.EVAL_DROP]: info.drop,
    [ATTR.RELIABILITY_DEGRADE_FROM]: info.from,
    [ATTR.RELIABILITY_DEGRADE_TO]: info.to,
  });
}
