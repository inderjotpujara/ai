import type { ModelDeclaration } from '../core/types.ts';
import { runGoldenEval } from '../verified-build/eval.ts';
import type { JudgeCandidate } from '../verified-build/judge.ts';
import { modelFamily } from '../verified-build/judge.ts';
import type {
  EvalResult,
  GoldenSet,
  ManifestEntry,
} from '../verified-build/types.ts';

/** Why a re-eval produced no verdict. Both outcomes are a uniform, non-fatal
 *  degrade — NEVER a regression and NEVER a demote (that is D4/D5's job, not
 *  this engine's): a re-eval that cannot grade simply yields nothing to diff. */
export enum ReevalSkip {
  /** The artifact has no persisted golden sidecar, so there is nothing to
   *  replay — an artifact built before goldens were persisted, or one whose
   *  sidecar is missing/malformed. `loadGolden` already degrades to null. */
  NoGolden = 'no-golden',
  /** No judge model cleared the parameter bar (`selectJudge` returned null via
   *  `runGoldenEval`), so no output could be graded. */
  JudgeUnavailable = 'judge-unavailable',
}

/** The freshly-resolved model identity a re-eval graded against — the exact
 *  `resolveModel` return, carried through so D4 can diff it against the
 *  entry's baseline `verifiedWith` and D6 can record it. */
export type ResolvedModel = { decl: ModelDeclaration; numCtx: number };

/** Discriminated union per repo style (`kind` literal discriminant). */
export type ReevalOutcome =
  | { kind: 'evaluated'; result: EvalResult; resolved: ResolvedModel }
  | { kind: 'skipped'; reason: ReevalSkip };

/** The seams a re-eval binds over — all injected so the engine itself stays
 *  provider/runtime-agnostic and unit-testable with no real model. */
export type ReevalDeps = {
  /** Re-resolve the artifact's requirement to the model that would run TODAY
   *  (backed by `resolveModel`). */
  resolve: (need: string) => Promise<ResolvedModel>;
  /** Run one golden case against the resolved model. `ref` is the artifact
   *  name (never a regenerated def — this engine never regenerates). */
  runCase: (
    ref: string,
    model: ModelDeclaration,
    input: string,
  ) => Promise<string>;
  judgeCandidates: () => JudgeCandidate[];
  judge: (model: string, prompt: string) => Promise<boolean>;
  loadGolden: (goldenPath: string) => GoldenSet | null;
};

/**
 * Replay an artifact's PERSISTED golden set against the freshly-resolved model.
 *
 * This is the generation-free half of the self-improvement loop: it NEVER
 * regenerates the artifact — no stage/structural/dry-run/makeGolden — it only
 * replays what was already proven. Degrades, never crashes: a missing golden
 * or a below-bar judge returns a `skipped` outcome (which is neither a pass nor
 * a regression), leaving the demote/record decisions to D4/D5/D6.
 */
export async function reevalArtifact(
  entry: ManifestEntry,
  name: string,
  deps: ReevalDeps,
): Promise<ReevalOutcome> {
  const golden = deps.loadGolden(entry.goldenPath);
  if (!golden) return { kind: 'skipped', reason: ReevalSkip.NoGolden };

  const resolved = await deps.resolve(entry.need);
  const result = await runGoldenEval({
    cases: golden.cases,
    judgeCandidates: deps.judgeCandidates,
    generatorFamily: modelFamily(resolved.decl.model),
    runCase: (input) => deps.runCase(name, resolved.decl, input),
    judge: deps.judge,
  });
  if (result === null) {
    return { kind: 'skipped', reason: ReevalSkip.JudgeUnavailable };
  }
  return { kind: 'evaluated', result, resolved };
}
