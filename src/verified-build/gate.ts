import { ATTR, withBuildVerifySpan } from '../telemetry/spans.ts';
import { repairLoop } from './repair.ts';
import type {
  ArtifactKind,
  CapabilitySignature,
  DryRunResult,
  EvalResult,
  GoldenSet,
  VerificationResult,
} from './types.ts';
import { VerifiedLevel } from './types.ts';

export type GateDeps = {
  kind: ArtifactKind;
  name: string;
  need: string;
  signature: CapabilitySignature;
  stage: (feedback?: string) => Promise<{ def: unknown }>;
  structural: (def: unknown) => Promise<string[]>;
  dryRunOnce: (def: unknown) => Promise<DryRunResult>;
  /** Evaluate the def against the ONE golden set the gate generated via
   *  `makeGolden` — the same set that gets persisted on commit, so the
   *  sidecar always replays exactly what was proven (C4). */
  goldenEval: (def: unknown, golden: GoldenSet) => Promise<EvalResult | null>;
  commit: (
    def: unknown,
    level: VerifiedLevel,
    golden: GoldenSet | null,
    vector: number[],
  ) => Promise<void>;
  /** Generate the golden set ONCE per gate pass — or return null when the
   *  judge is below bar, so no golden generation is paid for at all and the
   *  eval is skipped (degrade to VerifiedLevel.Runs). */
  makeGolden: () => Promise<GoldenSet | null>;
  /** Remove the staged (unregistered) artifact file. The gate calls this on
   *  every non-committed outcome — failure OR throw — so a rejected build
   *  never leaves an orphan file that breaks the next typecheck/lint (I2).
   *  Registry index + mcp.json are untouched either way: commit is the only
   *  step that writes them. */
  discard: (def: unknown) => Promise<void>;
  vector: number[];
  force: boolean;
};

/** Stage → structural check → dry-run (with repair loop) → golden eval →
 *  commit at the earned VerifiedLevel. `force` downgrades failures to an
 *  Unverified commit instead of aborting. Every outcome that did NOT commit
 *  (failed stage or a throw anywhere) discards the staged file via
 *  `deps.discard` so nothing broken lingers on disk (I2). */
export async function verifyAndCommit(
  deps: GateDeps,
): Promise<VerificationResult> {
  return withBuildVerifySpan(deps.kind, async (rec) => {
    let def: unknown;
    let committed = false;
    try {
      return await runGate(
        deps,
        rec,
        (d) => {
          def = d;
        },
        () => {
          committed = true;
        },
      );
    } finally {
      if (!committed && def !== undefined) {
        try {
          await deps.discard(def);
        } catch {
          // Best-effort cleanup — never mask the gate's own outcome.
        }
      }
    }
  });
}

type VerifyRec = {
  event(name: string, attrs?: Record<string, unknown>): void;
  attrs(attrs: Record<string, unknown>): void;
  result(level: VerifiedLevel, attrs?: Record<string, unknown>): void;
};

/** The gate body, split from `verifyAndCommit` so the discard-on-failure
 *  try/finally wraps the WHOLE flow (including throws) without nesting every
 *  early return. `onStaged`/`onCommitted` report state back to the wrapper. */
async function runGate(
  deps: GateDeps,
  rec: VerifyRec,
  onStaged: (def: unknown) => void,
  onCommitted: () => void,
): Promise<VerificationResult> {
  let def = (await deps.stage()).def;
  onStaged(def);

  const issues = await deps.structural(def);
  rec.event('structural', { issues: issues.length });
  if (issues.length > 0 && !deps.force) {
    return { kind: 'failed', stage: 'structural', detail: issues.join('; ') };
  }

  const dr = await repairLoop(async (fb) => {
    if (fb !== undefined) {
      def = (await deps.stage(fb)).def;
      onStaged(def);
    }
    return deps.dryRunOnce(def);
  });
  rec.event('dry_run', { ran: dr.ran, repairs: dr.repairs });
  rec.attrs({
    [ATTR.VERIFY_DRYRUN_RAN]: dr.ran,
    [ATTR.VERIFY_DRYRUN_REPAIRS]: dr.repairs,
  });
  if (!dr.ran && !deps.force) {
    return {
      kind: 'failed',
      stage: 'dry-run',
      detail: dr.error ?? 'did not run',
    };
  }

  // ONE golden set per gate pass (C4): generated here, evaluated below,
  // and persisted unchanged by commit — never two independent LLM calls
  // producing a persisted set that differs from the evaluated one. A null
  // golden means the judge is below bar: skip the eval entirely (degrade
  // to VerifiedLevel.Runs) without paying for golden generation.
  const golden = await deps.makeGolden();
  const ev = golden === null ? null : await deps.goldenEval(def, golden);
  rec.event(
    'golden_eval',
    ev
      ? { passed: ev.passed, total: ev.total, passedCount: ev.passedCount }
      : { skipped: true },
  );
  if (ev) {
    rec.attrs({
      [ATTR.VERIFY_JUDGE_MODEL]: ev.judgeModel,
      [ATTR.VERIFY_JUDGE_BELOW_BAR]: ev.belowBar,
      [ATTR.VERIFY_GOLDEN_PASSED]: ev.passedCount,
      [ATTR.VERIFY_GOLDEN_TOTAL]: ev.total,
    });
  } else {
    // A skipped eval means no judge cleared the bar (makeGolden returned
    // null) — record the degradation so it is observable.
    rec.attrs({ [ATTR.VERIFY_JUDGE_BELOW_BAR]: true });
  }
  let level = VerifiedLevel.Runs;
  if (ev) {
    if (!ev.passed && !deps.force) {
      return {
        kind: 'failed',
        stage: 'golden-eval',
        detail: `${ev.passedCount}/${ev.total}`,
      };
    }
    level = ev.passed ? VerifiedLevel.Behaves : VerifiedLevel.Unverified;
  }
  if (deps.force && (issues.length > 0 || !dr.ran || (ev && !ev.passed))) {
    level = VerifiedLevel.Unverified;
  }

  await deps.commit(def, level, golden, deps.vector);
  onCommitted();
  rec.result(level);
  return {
    kind: 'committed',
    name: deps.name,
    level,
    dryRun: dr,
    eval: ev ?? undefined,
  };
}
