import { z } from 'zod';
import type { RetrievalResult } from '../memory/types.ts';
import { withVerificationSpan } from '../telemetry/spans.ts';
import type { Step, WorkflowContext } from '../workflow/types.ts';
import { StepKind } from '../workflow/types.ts';
import { verifyMaxRetries } from './config.ts';
import { correctiveRetrieve } from './crag.ts';
import type { Verdict, VerifyDeps } from './types.ts';
import { verify } from './verify.ts';

/** Marker written to the workflow context by an `abstain` op. The crew/workflow
 *  engine scans the final context for this to surface an `unverified` outcome. */
export type UnverifiedMarker = {
  __unverified: true;
  answerStepId: string;
  unsupportedClaims: string[];
  faithfulness: number;
  draft: string;
};

export function isUnverifiedMarker(v: unknown): v is UnverifiedMarker {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as { __unverified?: unknown }).__unverified === true
  );
}

/** Zod schemas kept permissive: the closures produce well-formed objects, so the
 *  engine's post-step validation is a formality (never the correctness gate). */
const verdictSchema = z.custom<Verdict>((v) => !!v && typeof v === 'object');
const markerSchema = z.custom<UnverifiedMarker>(isUnverifiedMarker);

export type ExpandVerificationOpts = {
  /** The step id whose output is the answer to verify (the answering step). */
  answerStepId: string;
  /** The agent to re-run for the corrective re-answer (the answering agent). */
  answerAgent: string;
  /** Memory space to fetch cited evidence + re-recall from. */
  space: string;
  /** Injected verification deps (judge/decompose/getByIds). */
  verifyDeps: VerifyDeps;
  /** How to derive the query for verify + corrective from the run context.
   *  Default: the workflow input. */
  query?: (ctx: WorkflowContext) => string;
  /** Bounded corrective attempts; default `verifyMaxRetries()` (usually 1). */
  maxRetries?: number;
  /** Optional threshold override forwarded to `verify`. */
  threshold?: number;
};

const q = (ctx: WorkflowContext) => String(ctx.input ?? '');

/** Read the answer string a gate is verifying: the original answer, or the most
 *  recent corrective re-answer if one ran. */
function answerAt(ctx: WorkflowContext, stepId: string): string {
  const v = ctx[stepId];
  return typeof v === 'string' ? v : String(v ?? '');
}

/**
 * Expand a verified answer step into its verification sub-graph and return the
 * appended steps (the caller keeps the original answer step, then splices these
 * after it). Shape (for `answerStepId = T`, retries = R, one gate per attempt):
 *
 *   T                        (answer — caller's existing step; not returned here)
 *   T__verify   Verify       verify(answer=ctx[T])              -> Verdict
 *   T__branch   Branch       supported? whenTrue T__pass / whenFalse T__corrective
 *   T__pass     Verify(pass) no-op terminal (accept answer)
 *   T__corrective Verify(corrective) rewrite→re-recall→re-answer -> string
 *   T__verify2  Verify       verify(answer=ctx[T__corrective])  -> Verdict
 *   T__branch2  Branch       supported? whenTrue T__pass2 / whenFalse T__abstain
 *   T__pass2    Verify(pass) no-op terminal (accept corrective answer)
 *   T__abstain  Verify(abstain) writes UnverifiedMarker         -> marker
 *
 * With R corrective attempts the (corrective→verify→branch) block repeats R
 * times as a fixed unrolled chain (NOT a loop); the final gate's whenFalse is
 * the single abstain terminal. R=0 collapses to verify→branch→(pass|abstain).
 *
 * Backward-compatible: callers only expand steps that opted into `verify`, so a
 * plain task/workflow produces byte-identical output.
 */
export function expandVerification(opts: ExpandVerificationOpts): Step[] {
  const {
    answerStepId: T,
    answerAgent,
    space,
    verifyDeps,
    query = q,
    threshold,
  } = opts;
  const retries = opts.maxRetries ?? verifyMaxRetries();

  const steps: Step[] = [];
  const abstainId = `${T}__abstain`;

  const verifyStep = (
    id: string,
    source: string,
    dependsOn: string[],
  ): Step => ({
    id,
    kind: StepKind.Verify,
    op: 'verify',
    dependsOn,
    output: verdictSchema,
    run: async (ctx) => {
      const verdict = await verify(
        answerAt(ctx, source),
        { query: query(ctx), space, threshold },
        verifyDeps,
      );
      return verdict;
    },
  });

  const passStep = (id: string, dependsOn: string[]): Step => ({
    id,
    kind: StepKind.Verify,
    op: 'pass',
    dependsOn,
    output: z.unknown(),
    run: async () => ({ accepted: true }),
  });

  const branchStep = (
    id: string,
    verifyId: string,
    whenTrue: string,
    whenFalse: string,
  ): Step => ({
    id,
    kind: StepKind.Branch,
    dependsOn: [verifyId],
    output: z.object({ taken: z.string() }),
    predicate: (ctx) => !!(ctx[verifyId] as Verdict | undefined)?.supported,
    whenTrue,
    whenFalse,
  });

  // Gate 0 verifies the original answer.
  steps.push(verifyStep(`${T}__verify`, T, [T]));
  steps.push(passStep(`${T}__pass`, [`${T}__branch`]));

  // Unroll `retries` corrective attempts. `prevBranch` is the branch that routes
  // into the current attempt's corrective step; `sourceForGate` is the answer the
  // current gate verifies.
  let branchIdx = 0;
  let gateVerifyId = `${T}__verify`;
  let sourceForGate = T;

  for (let attempt = 0; attempt < retries; attempt++) {
    const branchId = attempt === 0 ? `${T}__branch` : `${T}__branch${attempt}`;
    const passId = attempt === 0 ? `${T}__pass` : `${T}__pass${attempt}`;
    const correctiveId =
      attempt === 0 ? `${T}__corrective` : `${T}__corrective${attempt}`;
    const nextVerifyId = `${T}__verify${attempt + 2}`;

    steps.push(branchStep(branchId, gateVerifyId, passId, correctiveId));
    if (attempt > 0) steps.push(passStep(passId, [branchId]));

    // Corrective: rewrite → re-recall → re-answer, then re-verify.
    steps.push(correctiveStep(correctiveId, branchId));
    steps.push(verifyStep(nextVerifyId, correctiveId, [correctiveId]));

    gateVerifyId = nextVerifyId;
    sourceForGate = correctiveId;
    branchIdx = attempt + 1;
  }

  // Final gate: on failure, abstain.
  const finalBranchId =
    retries === 0 ? `${T}__branch` : `${T}__branch${branchIdx}`;
  const finalPassId = retries === 0 ? `${T}__pass` : `${T}__pass${branchIdx}`;
  steps.push(branchStep(finalBranchId, gateVerifyId, finalPassId, abstainId));
  if (retries > 0) steps.push(passStep(finalPassId, [finalBranchId]));

  steps.push({
    id: abstainId,
    kind: StepKind.Verify,
    op: 'abstain',
    dependsOn: [finalBranchId],
    output: markerSchema,
    run: async (ctx) => {
      const verdict = ctx[gateVerifyId] as Verdict | undefined;
      const marker: UnverifiedMarker = {
        __unverified: true,
        answerStepId: T,
        unsupportedClaims: verdict?.unsupportedClaims ?? [],
        faithfulness: verdict?.faithfulness ?? 0,
        draft: answerAt(ctx, sourceForGate),
      };
      return marker;
    },
  });

  return steps;

  function correctiveStep(id: string, dependsOn: string): Step {
    return {
      id,
      kind: StepKind.Verify,
      op: 'corrective',
      dependsOn: [dependsOn],
      output: z.string(),
      run: async (ctx, deps) => {
        return withVerificationSpan({ crag: 'incorrect' }, async () => {
          const baseQuery = query(ctx);
          let evidence: RetrievalResult[] = [];
          let rewritten = baseQuery;
          if (deps.recall) {
            const recall = deps.recall as (
              qq: string,
            ) => Promise<RetrievalResult[]>;
            const res = await correctiveRetrieve(baseQuery, recall, verifyDeps);
            rewritten = res.query;
            evidence = res.chunks;
          }
          const evidenceBlock = evidence.length
            ? `\n\nAdditional evidence (cite as [mem:<id>]):\n${evidence
                .map((c) => `[mem:${c.id}] ${c.text}`)
                .join('\n')}`
            : '';
          const prevAnswer = answerAt(ctx, T);
          const task = `Your previous answer was not fully supported by cited evidence. Rewrite it so every claim is grounded in and cites the evidence below. Use [mem:<id>] citations.\n\nQuestion: ${rewritten}\n\nPrevious answer:\n${prevAnswer}${evidenceBlock}`;
          return deps.runAgentStep(answerAgent, task);
        });
      },
    };
  }
}
