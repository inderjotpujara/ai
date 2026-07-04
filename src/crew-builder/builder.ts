// src/crew-builder/builder.ts
import { pathToFileURL } from 'node:url';
import type { ValidationIssue } from '../agent-builder/types.ts';
import { atomicWrite } from '../agent-builder/write.ts';
import { embedOne } from '../memory/embed-one.ts';
import { recordReuseDecision, withCrewBuildSpan } from '../telemetry/spans.ts';
import { dryRunMs } from '../verified-build/config.ts';
import {
  representativeTask,
  withWallClock,
} from '../verified-build/dry-run.ts';
import { evalCases } from '../verified-build/eval.ts';
import type { GateDeps } from '../verified-build/gate.ts';
import { verifyAndCommit } from '../verified-build/gate.ts';
import { generateGolden, goldenPathFor } from '../verified-build/golden.ts';
import { selectJudge } from '../verified-build/judge.ts';
import { upsertEntry } from '../verified-build/manifest.ts';
import { reuseDecision } from '../verified-build/reuse.ts';
import {
  signatureFromIR,
  signatureFromNeed,
  signatureText,
} from '../verified-build/signature.ts';
import {
  ArtifactKind,
  ReuseKind,
  VerifiedLevel,
} from '../verified-build/types.ts';
import { analyzeNeed } from './analyze.ts';
import { classifyNeed } from './classify.ts';
import type { CrewIR, WorkflowIR } from './ir.ts';
import { planEdges } from './plan-edges.ts';
import { planNodes } from './plan-nodes.ts';
import { referencedAgents, resolveMissingAgents } from './resolve-members.ts';
import { transpile } from './transpile.ts';
import type {
  CrewBuilderDeps,
  CrewBuilderVerifyDeps,
  CrewBuildResult,
  Shape,
} from './types.ts';
import { validateIR, validateStructural } from './validate.ts';
import {
  registerCrewOrWorkflow,
  writeCrewFile,
  writeCrewOrWorkflow,
} from './write.ts';

const MAX_REGENERATIONS = 1;

type Rec = {
  event: (
    name: string,
    attrs?: Record<string, string | number | boolean>,
  ) => void;
  outcome: (
    kind: string,
    shape?: string,
    id?: string,
    memberOrStepCount?: number,
    membersBuilt?: number,
  ) => void;
};

/** Render the consent prompt: the proposed IR's shape/tasks-or-steps, the
 *  new agents that will be built (if any), and the files it will write. */
function renderSummary(
  ir: CrewIR | WorkflowIR,
  shape: Shape,
  planned: string[],
): string {
  const head = `Proposed ${shape} "${ir.id}"${ir.description ? ` — ${ir.description}` : ''}`;
  const body =
    shape === 'crew'
      ? (ir as CrewIR).tasks
          .map((t) => `  • ${t.member}: ${t.description}`)
          .join('\n')
      : (ir as WorkflowIR).steps
          .map((s) => `  • ${s.id} [${s.kind}]`)
          .join('\n');
  const built = planned.length
    ? `\nWill build new agents: ${planned.join(', ')}`
    : '';
  const files =
    shape === 'crew'
      ? `crews/${ir.id}.ts, crews/index.ts`
      : `workflows/${ir.id}.ts, workflows/index.ts`;
  return `${head}\n${body}${built}\nFiles: ${files}`;
}

function memberOrStepCount(ir: CrewIR | WorkflowIR, shape: Shape): number {
  return shape === 'crew'
    ? (ir as CrewIR).members.length
    : (ir as WorkflowIR).steps.length;
}

function finish(
  rec: Rec,
  shape: Shape,
  result: CrewBuildResult,
  ir?: CrewIR | WorkflowIR,
): CrewBuildResult {
  if (result.kind === 'written') {
    const count = ir ? memberOrStepCount(ir, shape) : undefined;
    rec.outcome(
      'written',
      shape,
      result.name,
      count,
      result.builtAgents.length,
    );
  } else {
    rec.outcome(result.kind, shape);
  }
  return result;
}

/** The manifest/golden sidecar directory for a shape — crews and workflows
 *  are separate registries, so (unlike agent-builder's single `agents/`
 *  directory) this must be resolved per call from the shape. */
function dirFor(shape: Shape, paths: CrewBuilderDeps['paths']): string {
  return shape === 'crew' ? paths.crewsDir : paths.workflowsDir;
}

/** What flows through the gate's `def: unknown` for a crew/workflow build:
 *  the IR (structural validation, commit/registration) and the runnable
 *  CrewDef/WorkflowDef dynamically imported from the staged file (dry-run,
 *  golden-eval). Mirrors agent-builder's `StagedAgent`. */
type StagedArtifact = { ir: CrewIR | WorkflowIR; def: unknown };

/** Build the `GateDeps` for one crew/workflow IR and run `verifyAndCommit`,
 *  then map its `VerificationResult` onto `CrewBuildResult`. Split out of
 *  `buildCrewOrWorkflow` to keep the consent-gated happy path readable —
 *  mirrors agent-builder's `verifyAndCommitProposal`. */
async function verifyAndCommitCrewOrWorkflow(
  need: string,
  ir: CrewIR | WorkflowIR,
  shape: Shape,
  builtAgents: string[],
  deps: CrewBuilderDeps,
  verify: CrewBuilderVerifyDeps,
): Promise<CrewBuildResult> {
  const sig = signatureFromIR(ir, shape);
  const vector = await embedOne(signatureText(sig), verify.embed);
  const dir = dirFor(shape, deps.paths);
  let stagedPath: string | undefined;
  let registeredFiles: string[] = [];

  const gateDeps: GateDeps = {
    kind: shape === 'crew' ? ArtifactKind.Crew : ArtifactKind.Workflow,
    name: ir.id,
    need,
    signature: sig,
    stage: async (_feedback) => {
      // v1: feedback-driven repair of the IR itself isn't implemented yet —
      // a re-stage (after a failed dry-run) just rewrites the SAME IR, a
      // no-op regeneration acceptable for v1 per spec (mirrors
      // agent-builder's `verifyAndCommitProposal.stage`).
      // TODO(controller): route `_feedback` into a targeted regeneration.
      const source = transpile(ir, shape);
      stagedPath = writeCrewFile(ir.id, source, shape, deps.paths);
      // Cache-bust: a repair re-stage overwrites the SAME path, and a bare
      // `import()` would otherwise return the previously-cached module.
      const mod = (await import(
        `${pathToFileURL(stagedPath).href}?t=${Date.now()}`
      )) as { default: unknown };
      const staged: StagedArtifact = { ir, def: mod.default };
      return { def: staged };
    },
    structural: async (def) => {
      const { ir: staged } = def as StagedArtifact;
      return validateStructural(staged, shape, {
        existingAgents: [...deps.existingAgents(), ...builtAgents],
        packNames: deps.packNames(),
        toBeBuilt: [],
        model: deps.model,
      }).map((i) => `${i.field}: ${i.problem}`);
    },
    // Every dry-run/golden-eval run is wall-clock-bounded by dryRunMs():
    // withWallClock rejects on timeout (caught here, reported as a failed
    // run) so a hung crew/workflow run fails the gate instead of hanging the
    // whole build (C1). Unlike the agent path there is no AbortSignal to
    // thread — runCrew/runWorkflow don't accept one yet, so the bound is the
    // wall clock at the call site.
    dryRunOnce: async (def) => {
      const { def: runnable } = def as StagedArtifact;
      try {
        const r = await withWallClock(dryRunMs(), () =>
          verify.runArtifact(runnable, shape, representativeTask(need, sig)),
        );
        return {
          ran: 'text' in r,
          output: 'text' in r ? r.text : undefined,
          error: 'error' in r ? r.error : undefined,
          repairs: 0,
        };
      } catch (err) {
        return { ran: false, error: String(err), repairs: 0 };
      }
    },
    goldenEval: async (def, golden) => {
      const { def: runnable } = def as StagedArtifact;
      const judgePick = selectJudge({
        candidates: verify.judgeCandidates,
        generatorFamily: verify.generatorFamily,
      });
      // Unreachable when makeGolden gated golden generation on the same
      // pick — kept as defense so a below-bar judge can never grade.
      if (judgePick.model === null) return null;
      const judgeModelId = judgePick.model;
      return evalCases(golden.cases, {
        runCase: async (input) => {
          try {
            const r = await withWallClock(dryRunMs(), () =>
              verify.runArtifact(runnable, shape, input),
            );
            return 'text' in r ? r.text : `error: ${r.error}`;
          } catch (err) {
            return `error: ${String(err)}`;
          }
        },
        // Bind the SELECTED judge model id into every judge call (C3): the
        // judge must run on the model selectJudge picked, not the generator.
        judge: (prompt) => verify.judge(prompt, judgeModelId),
        judgeModel: judgeModelId,
        belowBar: judgePick.belowBar,
      });
    },
    // The gate's ONE golden generation (C4). A below-bar judge returns null
    // BEFORE generating — no golden is paid for when nothing can grade it.
    makeGolden: async () => {
      const judgePick = selectJudge({
        candidates: verify.judgeCandidates,
        generatorFamily: verify.generatorFamily,
      });
      if (judgePick.model === null) return null;
      return generateGolden(need, sig, deps.model);
    },
    commit: async (def, level, golden, vec) => {
      const { ir: staged } = def as StagedArtifact;
      registeredFiles = registerCrewOrWorkflow(staged.id, shape, deps.paths);
      const goldenPath = goldenPathFor(dir, staged.id);
      upsertEntry(dir, staged.id, {
        need,
        signature: signatureFromIR(staged, shape),
        vector: vec,
        verifiedLevel: level,
        goldenPath,
        createdAtMs: Date.now(),
        lastUsedMs: 0,
        useCount: 0,
        lastEvalPass: level === VerifiedLevel.Behaves,
      });
      if (golden) {
        atomicWrite(goldenPath, `${JSON.stringify(golden, null, 2)}\n`);
      }
    },
    vector,
    force: verify.force ?? false,
  };

  const result = await verifyAndCommit(gateDeps);
  if (result.kind === 'committed') {
    const files = stagedPath
      ? [stagedPath, ...registeredFiles]
      : registeredFiles;
    deps.log?.(
      `Created ${shape} "${ir.id}" (${files.length} file(s), verified: ${result.level}). It is live on the next run.`,
    );
    return {
      kind: 'written',
      shape,
      name: ir.id,
      files,
      builtAgents,
      level: result.level,
    };
  }
  if (result.kind === 'reused') {
    return { kind: 'reused', name: result.name, similarity: result.similarity };
  }
  return {
    kind: 'failed-verification',
    stage: result.stage,
    detail: result.detail,
  };
}

/** Orchestrates the crew/workflow-builder end to end: classify the need's
 *  shape, analyze it into a prose plan, generate+validate an IR (with one
 *  bounded regeneration), get consent on a rendered summary, THEN build any
 *  missing agents and rewrite the IR's refs to their actual built names, and
 *  finally transpile+write.
 *
 *  Building happens once, AFTER consent — never inside the regeneration
 *  loop. `resolveMissingAgents`'s "already built?" check reads
 *  `deps.existingAgents()`, an in-memory registry snapshot that doesn't pick
 *  up an agent written to disk mid-run (only on next process start). Calling
 *  it per attempt would re-build the same agent on every retry. Instead, the
 *  loop only computes which agents WOULD need building (`referencedAgents`
 *  minus `existingAgents()`) so validation's `toBeBuilt` can treat them as
 *  known — the actual build happens exactly once, after the user has
 *  consented to the plan.
 *
 *  When `deps.verify` is present, a reuse-check runs right after
 *  classification (shape must be known first, since crews/workflows are
 *  separate registries) and short-circuits before any generation on a hit;
 *  otherwise the flow continues as above through consent, then — after
 *  `resolveMissingAgents` — the transpiled IR is staged and run through
 *  `verifyAndCommit` (structural / dry-run / golden-eval) BEFORE it is
 *  registered, mirroring the agent-builder's gate (Slice 20). */
export function buildCrewOrWorkflow(
  need: string,
  deps: CrewBuilderDeps,
): Promise<CrewBuildResult> {
  return withCrewBuildSpan(need, async (rec) => {
    const shape = await classifyNeed(need, deps.model);
    rec.event('classified', { shape });

    if (deps.verify) {
      const needSig = await signatureFromNeed(need, deps.model);
      const decision = await reuseDecision(needSig, {
        embed: deps.verify.embed,
        dir: dirFor(shape, deps.paths),
      });
      rec.event('reuse_checked', {
        kind: decision.kind,
        similarity: decision.similarity,
      });
      recordReuseDecision(decision.kind, decision.similarity);
      if (decision.kind === ReuseKind.Reuse && decision.match) {
        return finish(rec, shape, {
          kind: 'reused',
          name: decision.match,
          similarity: decision.similarity,
        });
      }
    }

    const analysis = await analyzeNeed(need, shape, deps.model);
    rec.event('analyzed');

    let ir: CrewIR | WorkflowIR | undefined;
    let issues: ValidationIssue[] = [];
    let planned: string[] = [];
    for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
      // planNodes/planEdges call the live model's structured-generation seam
      // directly (not through validateIR), so a malformed response that
      // survives its own internal retry throws rather than returning an
      // issue list. Treat that the same as a validation failure — one more
      // bounded regeneration attempt — instead of letting it crash the
      // whole build (found live: qwen3.5:9b occasionally still misses the
      // IR schema on both of model.object's internal attempts; Slice 19
      // Task 19).
      try {
        const nodes = await planNodes(
          need,
          shape,
          analysis,
          deps.model,
          deps.packNames(),
        );
        ir = await planEdges(need, shape, analysis, nodes, deps.model);
      } catch (e) {
        rec.event('generation-failed', { attempt });
        issues = [
          {
            field: 'generation',
            problem: e instanceof Error ? e.message : String(e),
          },
        ];
        continue;
      }
      rec.event('generated', { attempt });

      const existing = new Set(deps.existingAgents());
      planned = referencedAgents(ir, shape).filter((n) => !existing.has(n));

      issues = await validateIR(
        ir,
        shape,
        {
          existingAgents: deps.existingAgents(),
          packNames: deps.packNames(),
          toBeBuilt: planned,
          model: deps.model,
        },
        need,
      );
      rec.event('validated', { attempt, issues: issues.length });
      if (issues.length === 0) break;
    }
    if (!ir || issues.length > 0)
      return finish(rec, shape, { kind: 'invalid', issues });

    const granted = await deps.confirm(renderSummary(ir, shape, planned));
    if (!granted) return finish(rec, shape, { kind: 'declined' });

    // `resolveMissingAgents` delegates each missing agent to the
    // agent-builder, whose `generateProposal` THROWS when the model can't
    // return valid JSON after its own bounded retries (found live: a crew
    // that referenced a to-be-built agent hit `agent-builder: model did not
    // return valid JSON for the proposal` and rejected the whole
    // `buildCrewOrWorkflow` call). That's the same throw-vs-result-kind gap
    // the generation loop above guards — a failed auto-build is exactly an
    // `abandoned` outcome, not an unhandled rejection, so treat a throw here
    // the same as `buildMissingAgent` returning null (Slice 19
    // close-review). Only the model-driven resolve step is wrapped;
    // transpile/write are deterministic and must still surface real bugs.
    let resolved: Awaited<ReturnType<typeof resolveMissingAgents>>;
    try {
      resolved = await resolveMissingAgents(ir, shape, deps);
    } catch (e) {
      rec.event('build-failed');
      return finish(rec, shape, {
        kind: 'abandoned',
        reason: `agent build failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    if (resolved.abandoned)
      return finish(rec, shape, {
        kind: 'abandoned',
        reason: resolved.abandoned,
      });

    if (deps.verify) {
      const result = await verifyAndCommitCrewOrWorkflow(
        need,
        resolved.ir,
        shape,
        resolved.builtAgents,
        deps,
        deps.verify,
      );
      rec.event('gate_result', { kind: result.kind });
      return finish(rec, shape, result, resolved.ir);
    }

    const source = transpile(resolved.ir, shape);
    const files = writeCrewOrWorkflow(
      resolved.ir.id,
      source,
      shape,
      deps.paths,
    );
    rec.event('written');
    return finish(
      rec,
      shape,
      {
        kind: 'written',
        shape,
        name: resolved.ir.id,
        files,
        builtAgents: resolved.builtAgents,
      },
      resolved.ir,
    );
  });
}
