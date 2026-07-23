/**
 * The Eval executor (Slice 32, Task 15) — the orchestration keystone that ties
 * the continuous re-eval loop together. `RunEvalTurn` (Task 8) invokes `runEval`
 * for a `JobKind.Eval` job; it drives one of three modes:
 *
 *   - `Sweep`         — read every reusable artifact across `registryDirs`,
 *                       order HOT-FIRST by span-derived usage, and for each:
 *                       SEED a missing baseline inline (R5, never a regression),
 *                       or enqueue a per-artifact `Eval` job when the resolved
 *                       model DRIFTED from the entry's `verifiedWith` (R4 de-dup),
 *                       or skip. Per-artifact enqueue (not inline evaluate) keeps
 *                       one artifact's judge-unavailable/throw from aborting the
 *                       sweep and gives retry granularity.
 *   - `AffectedByPull`— ONE coalesced re-resolve pass over ALL entries after a
 *                       model pull (§7.5): a mass pull must NOT fan out to N×
 *                       full sweeps. The drifted set enqueues per-artifact jobs.
 *   - `Artifact`      — the actual evaluate+decide+act for ONE artifact:
 *                       `reevalArtifact` → seed-or-`decideRegression` →
 *                       `applyRegressionOutcome`, wrapped in `withEvalReevalSpan`
 *                       so the run classifies as `RunKind.Eval`.
 *
 * DEGRADE-NEVER-CRASH is the defining property (§7.2): every per-artifact op in
 * Sweep/AffectedByPull is wrapped in try/catch that logs + continues — a
 * `resolve` throw, a missing golden, or a below-bar judge skips ONLY that
 * artifact, never aborts the pass, never half-writes the manifest (writes stay
 * atomic read-modify-write via `upsertEntry`; the executor is single-threaded
 * per job so writes serialize).
 */

import { randomUUID } from 'node:crypto';
import type { OrchestratorResult } from '../core/orchestrator.ts';
import { createLogger } from '../log/logger.ts';
import type { JobStore } from '../queue/store.ts';
import { JobKind, JobStatus } from '../queue/types.ts';
import { EvalMode } from '../server/jobs/dispatch.ts';
import type { EvalDeps } from '../verified-build/eval.ts';
import { evalCases } from '../verified-build/eval.ts';
import { readManifest } from '../verified-build/manifest.ts';
import type {
  EvalCaseResult,
  EvalResult,
  GoldenSet,
  ManifestEntry,
} from '../verified-build/types.ts';
import { aggregateUsage } from '../verified-build/usage.ts';
import { verifiedWithFrom } from '../verified-build/verified-with.ts';
import type { ApplyDeps } from './action.ts';
import { applyRegressionOutcome } from './action.ts';
import { reevalEnabled, reevalHysteresis, reevalRerunCases } from './config.ts';
import type { EvalHistoryStore } from './history.ts';
import {
  type ReevalDeps,
  ReevalSkip,
  type ResolvedModel,
  reevalArtifact,
} from './reeval.ts';
import { decideRegression } from './regression.ts';
import { withEvalReevalSpan } from './spans.ts';

const log = createLogger('self-improve.executor');

export type RunEvalDeps = ReevalDeps & {
  /** The generated-artifact registry dirs to scan (each carries a manifest). */
  registryDirs: string[];
  /** Runs root for `aggregateUsage` hot-first ordering. */
  runsRoot: string;
  history: EvalHistoryStore;
  upsertEntry: ApplyDeps['upsertEntry'];
  /** For R4 de-dup + per-artifact enqueue. NOTE: the real `JobStore` exposes
   *  `listJobs` (not `list` as an earlier brief named it) — kept faithful to
   *  the live signature so Task 16 wires the real store unchanged. */
  jobStore: Pick<JobStore, 'enqueue' | 'listJobs'>;
  now?: () => number;
};

type RunEvalInput = {
  mode: EvalMode;
  ref?: string;
  reason?: string;
  signal?: AbortSignal;
};

type LocatedEntry = { dir: string; name: string; entry: ManifestEntry };

export async function runEval(
  input: RunEvalInput,
  deps: RunEvalDeps,
): Promise<OrchestratorResult> {
  // Master switch: detection + auto-demote off, but a MANUAL single-artifact
  // eval still runs (the CLI / POST /api/evals/reeval path).
  if (!reevalEnabled() && input.mode !== EvalMode.Artifact) {
    return { kind: 'answer', text: 'reeval disabled' };
  }
  switch (input.mode) {
    case EvalMode.Sweep:
      return runSweep(input, deps);
    case EvalMode.AffectedByPull:
      return runPull(input, deps);
    case EvalMode.Artifact:
      return runArtifact(input, deps);
    default: {
      const _exhaustive: never = input.mode;
      throw new Error(`unhandled eval mode: ${String(_exhaustive)}`);
    }
  }
}

// ── Sweep ────────────────────────────────────────────────────────────────

async function runSweep(
  input: RunEvalInput,
  deps: RunEvalDeps,
): Promise<OrchestratorResult> {
  const now = deps.now ?? Date.now;
  const entries = orderHotFirst(
    collectEntries(deps.registryDirs),
    deps.runsRoot,
  );
  let enqueued = 0;
  let seeded = 0;
  for (const located of entries) {
    if (input.signal?.aborted) break;
    // §7.2: one artifact's failure never aborts the sweep.
    try {
      if (located.entry.verifiedWith === undefined) {
        // R5 SEED inline — captures the baseline, NEVER a regression/demote.
        await seedInline(located, deps, input.reason, now);
        seeded += 1;
        continue;
      }
      const resolved = await deps.resolve(located.entry.need);
      if (drifted(resolved, located.entry)) {
        if (!hasPendingEval(deps.jobStore, located.name)) {
          deps.jobStore.enqueue(evalJob(located.name, 'sweep'));
          enqueued += 1;
        }
      }
      // else: no drift → skip.
    } catch (err) {
      log.warn('reeval sweep: artifact skipped', {
        artifact: located.name,
        err: String(err),
      });
    }
  }
  return {
    kind: 'answer',
    text: `sweep: ${enqueued} enqueued, ${seeded} seeded`,
  };
}

// ── AffectedByPull ─────────────────────────────────────────────────────────

async function runPull(
  input: RunEvalInput,
  deps: RunEvalDeps,
): Promise<OrchestratorResult> {
  // ONE re-resolve pass over ALL entries (§7.5 coalesce): a mass pull enqueues
  // N single per-artifact jobs, never N nested sweeps.
  const entries = collectEntries(deps.registryDirs);
  const reason = input.reason ?? 'pull';
  let enqueued = 0;
  for (const located of entries) {
    if (input.signal?.aborted) break;
    try {
      // No baseline to diff against → seeding is the sweep's job, not the pull's.
      if (located.entry.verifiedWith === undefined) continue;
      const resolved = await deps.resolve(located.entry.need);
      if (drifted(resolved, located.entry)) {
        if (!hasPendingEval(deps.jobStore, located.name)) {
          deps.jobStore.enqueue(evalJob(located.name, reason));
          enqueued += 1;
        }
      }
    } catch (err) {
      log.warn('reeval pull: artifact skipped', {
        artifact: located.name,
        err: String(err),
      });
    }
  }
  return { kind: 'answer', text: `affected-by-pull: ${enqueued} enqueued` };
}

// ── Artifact (evaluate + decide + act for ONE artifact) ─────────────────────

async function runArtifact(
  input: RunEvalInput,
  deps: RunEvalDeps,
): Promise<OrchestratorResult> {
  const ref = input.ref;
  if (!ref) return { kind: 'answer', text: 'ref required for artifact eval' };
  const found = findEntry(deps.registryDirs, ref);
  if (!found) return { kind: 'answer', text: `unknown artifact: ${ref}` };
  const { dir, entry } = found;

  // Fast NoGolden exit BEFORE any resolve — nothing to replay.
  if (deps.loadGolden(entry.goldenPath) === null) {
    return { kind: 'answer', text: 'skipped: no golden' };
  }

  const now = deps.now ?? Date.now;
  // Memoize resolve so the span opens with the REAL current model without a
  // second resolve inside reevalArtifact.
  let cached: ResolvedModel | undefined;
  const resolve = async (need: string): Promise<ResolvedModel> => {
    cached ??= await deps.resolve(need);
    return cached;
  };
  const resolved = await resolve(entry.need);
  const baselineModel = entry.verifiedWith?.model;

  return withEvalReevalSpan(
    {
      artifact: ref,
      mode: input.mode,
      baselineModel,
      currentModel: resolved.decl.model,
    },
    async (rec) => {
      const outcome = await reevalArtifact(entry, ref, { ...deps, resolve });
      if (outcome.kind === 'skipped') {
        // NoGolden was handled above → this is JudgeUnavailable: record an
        // inconclusive row (no verdict to diff), NEVER demote.
        rec.outcome('inconclusive');
        deps.history.insert(
          inconclusiveRow(ref, entry.verifiedWith?.model, input.reason, now),
        );
        return { kind: 'answer', text: 'inconclusive: judge unavailable' };
      }

      const { result, resolved: r } = outcome;
      rec.golden(result.passedCount, result.total);
      rec.judge(result.judgeModel, result.belowBar);

      const baselineRow = deps.history.latestPassing(ref);
      // SEED when there is no baseline, OR re-SEED (Finding #2 guard) when the
      // baseline's case-id universe differs from the fresh golden — diffing a
      // stale/larger baseline would DILUTE `drop` and MASK a real regression.
      if (!baselineRow || !sameCaseIds(baselineRow.perCase, result.perCase)) {
        recordSeed(dir, ref, entry, result, r, input.reason, deps, now);
        rec.outcome(baselineRow ? 're-seed' : 'seed');
        return { kind: 'answer', text: `seeded baseline: ${ref}` };
      }

      const baseline: EvalResult = {
        passed: baselineRow.passed,
        total: baselineRow.total,
        passedCount: baselineRow.passedCount,
        perCase: baselineRow.perCase,
        judgeModel: baselineRow.judgeModel,
        belowBar: baselineRow.belowBar,
      };
      const golden = deps.loadGolden(entry.goldenPath);
      const decision = await decideRegression({
        baseline,
        fresh: result,
        hysteresis: reevalHysteresis(),
        rerunCases: reevalRerunCases(),
        rerun: buildRerun(golden, r, ref, result, deps),
      });
      rec.outcome(decision.verdict);
      // Finding #4: surface a demote-persist failure distinctly. In Artifact
      // mode a persistent write failure fails the job (retryable) — but Ops
      // still sees the distinct WARN rather than a silent swallow.
      try {
        applyRegressionOutcome(
          {
            dir,
            name: ref,
            entry,
            outcome: decision,
            result,
            currentModel: r.decl.model,
            baselineModel,
            reason: input.reason,
          },
          { history: deps.history, upsertEntry: deps.upsertEntry, now },
        );
      } catch (err) {
        log.warn('reeval: applyRegressionOutcome persist failed', {
          artifact: ref,
          err: String(err),
        });
        throw err;
      }
      return { kind: 'answer', text: decision.verdict };
    },
  );
}

// ── Seed helpers (R5 — baseline capture, never a regression) ────────────────

async function seedInline(
  located: LocatedEntry,
  deps: RunEvalDeps,
  reason: string | undefined,
  now: () => number,
): Promise<void> {
  const { dir, name, entry } = located;
  if (deps.loadGolden(entry.goldenPath) === null) return; // nothing to seed
  const outcome = await reevalArtifact(entry, name, deps);
  if (outcome.kind === 'skipped') {
    if (outcome.reason === ReevalSkip.JudgeUnavailable) {
      deps.history.insert(
        inconclusiveRow(name, entry.verifiedWith?.model, reason, now),
      );
    }
    return; // NoGolden → nothing recorded.
  }
  recordSeed(
    dir,
    name,
    entry,
    outcome.result,
    outcome.resolved,
    reason,
    deps,
    now,
  );
}

function recordSeed(
  dir: string,
  name: string,
  entry: ManifestEntry,
  result: EvalResult,
  resolved: ResolvedModel,
  reason: string | undefined,
  deps: RunEvalDeps,
  now: () => number,
): void {
  deps.history.insert(
    baselineRowFrom(
      name,
      resolved.decl.model,
      undefined,
      result,
      false,
      reason,
      now,
    ),
  );
  // Persist verifiedWith + lastEvalPass; KEEP verifiedLevel (a seed never
  // promotes or demotes). Finding #4: a persistent persist failure is logged
  // DISTINCTLY (an under-reported baseline means drift never gets a baseline to
  // diff, silently under-reporting future regressions) — then swallowed so the
  // sweep continues.
  try {
    deps.upsertEntry(dir, name, {
      ...entry,
      verifiedWith: verifiedWithFrom(resolved, now()),
      lastEvalPass: result.passed,
    });
  } catch (err) {
    log.warn('reeval: manifest persist failed (baseline not recorded)', {
      artifact: name,
      err: String(err),
    });
  }
}

// ── Rerun closure (bounded unanimous-fail confirmation seam for D4) ─────────

function buildRerun(
  golden: GoldenSet | null,
  resolved: ResolvedModel,
  ref: string,
  result: EvalResult,
  deps: RunEvalDeps,
): (caseIds: string[], count: number) => Promise<Record<string, boolean[]>> {
  const evalDeps: EvalDeps = {
    runCase: (inp) => deps.runCase(ref, resolved.decl, inp),
    judge: (prompt) => deps.judge(result.judgeModel, prompt),
    judgeModel: result.judgeModel,
    belowBar: result.belowBar,
  };
  return async (caseIds, count) => {
    const out: Record<string, boolean[]> = {};
    for (const id of caseIds) {
      const c = golden?.cases.find((x) => x.id === id);
      if (!c) {
        out[id] = [];
        continue;
      }
      const runs: boolean[] = [];
      for (let i = 0; i < count; i++) {
        // Re-run ONLY this case on the SAME resolved decl + SAME judge (one
        // `evalCases` pass over a single case mirrors the unanimous-Yes rule).
        const r = await evalCases([c], evalDeps);
        runs.push(r.perCase[0]?.passed ?? false);
      }
      out[id] = runs;
    }
    return out;
  };
}

// ── Small pure helpers ──────────────────────────────────────────────────────

function collectEntries(dirs: string[]): LocatedEntry[] {
  const out: LocatedEntry[] = [];
  for (const dir of dirs) {
    const manifest = readManifest(dir);
    for (const [name, entry] of Object.entries(manifest.entries)) {
      out.push({ dir, name, entry });
    }
  }
  return out;
}

function orderHotFirst(
  entries: LocatedEntry[],
  runsRoot: string,
): LocatedEntry[] {
  const usage = aggregateUsage(runsRoot);
  return [...entries].sort((a, b) => {
    const la = usage[a.name]?.lastUsedMs ?? 0;
    const lb = usage[b.name]?.lastUsedMs ?? 0;
    if (lb !== la) return lb - la;
    return (usage[b.name]?.useCount ?? 0) - (usage[a.name]?.useCount ?? 0);
  });
}

function findEntry(
  dirs: string[],
  ref: string,
): { dir: string; entry: ManifestEntry } | undefined {
  for (const dir of dirs) {
    const entry = readManifest(dir).entries[ref];
    if (entry) return { dir, entry };
  }
  return undefined;
}

function drifted(resolved: ResolvedModel, entry: ManifestEntry): boolean {
  return resolved.decl.model !== entry.verifiedWith?.model;
}

function evalJob(
  ref: string,
  reason: string,
): {
  kind: JobKind;
  payload: { mode: EvalMode; ref: string; reason: string };
} {
  return {
    kind: JobKind.Eval,
    payload: { mode: EvalMode.Artifact, ref, reason },
  };
}

/** R4 de-dup: a Queued/Running `Eval` job whose payload `ref` matches already
 *  covers this artifact, so a fresh enqueue would be a duplicate. */
function hasPendingEval(
  jobStore: Pick<JobStore, 'listJobs'>,
  ref: string,
): boolean {
  for (const status of [JobStatus.Queued, JobStatus.Running]) {
    let cursor: string | undefined;
    for (let guard = 0; guard < 10000; guard++) {
      const page = jobStore.listJobs({ status, cursor, limit: 200 });
      for (const job of page.items) {
        if (job.kind !== JobKind.Eval) continue;
        const payload = job.payload as { ref?: unknown } | null;
        if (payload && payload.ref === ref) return true;
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  }
  return false;
}

function sameCaseIds(a: EvalCaseResult[], b: EvalCaseResult[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((c) => c.id));
  return b.every((c) => ids.has(c.id));
}

function baselineRowFrom(
  name: string,
  model: string,
  baselineModel: string | undefined,
  result: EvalResult,
  regressed: boolean,
  reason: string | undefined,
  now: () => number,
) {
  return {
    id: randomUUID(),
    artifactId: name,
    model,
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
}

function inconclusiveRow(
  name: string,
  model: string | undefined,
  reason: string | undefined,
  now: () => number,
) {
  return {
    id: randomUUID(),
    artifactId: name,
    model: model ?? '',
    baselineModel: model,
    ts: now(),
    passed: false,
    passedCount: 0,
    total: 0,
    regressed: false,
    perCase: [],
    judgeModel: '',
    belowBar: true,
    reason,
  };
}
