import { runTimeoutMs } from '../reliability/config.ts';
import { withWallClock } from '../reliability/timeout.ts';
import { withStepSpan } from '../telemetry/spans.ts';
import {
  isUnverifiedMarker,
  type UnverifiedMarker,
} from '../verification/expand.ts';
import {
  autoPersistStepOutput,
  DEFAULT_MAX_PARALLEL,
  runStepByKind,
  type WorkflowDeps,
} from './run-step.ts';
import {
  effectiveDeps,
  type Step,
  StepKind,
  type WorkflowContext,
  type WorkflowDef,
  type WorkflowOutcome,
} from './types.ts';

export type { WorkflowDeps } from './run-step.ts';
export { defaultRunAgentStep } from './run-step.ts';

type StepResult = { step: Step; value: unknown } | { step: Step; error: Error };

/** Scan a finished run's context for an abstain marker (a verified step whose
 *  answer stayed unsupported after bounded correction). First marker wins.
 *  Mirrors `findUnverified` in src/crew/engine.ts. */
function findUnverified(ctx: WorkflowContext): UnverifiedMarker | undefined {
  for (const v of Object.values(ctx)) {
    if (isUnverifiedMarker(v)) return v;
  }
  return undefined;
}

/** Execute a workflow DAG: topological scheduling with bounded concurrency,
 *  per-step zod output validation, per-step onError policy, and branch skipping. */
export async function runWorkflow(
  def: WorkflowDef,
  input: unknown,
  deps: WorkflowDeps,
): Promise<WorkflowOutcome> {
  const maxParallel = deps.maxParallel ?? DEFAULT_MAX_PARALLEL;
  const ctx: WorkflowContext = { input };
  const steps = def.steps;
  const done = new Set<string>();
  const skipped = new Set<string>();

  const isReady = (step: Step, i: number): boolean => {
    if (done.has(step.id) || skipped.has(step.id)) return false;
    const d = effectiveDeps(step, i, steps);
    if (d.some((id) => skipped.has(id))) {
      skipped.add(step.id); // dead-arm / continue propagation
      return false;
    }
    return d.every((id) => done.has(id));
  };

  let failure: WorkflowOutcome | null = null;
  while (!failure) {
    const batch = steps.filter((s, i) => isReady(s, i)).slice(0, maxParallel);
    if (batch.length === 0) break; // nothing runnable → done or fully skipped

    const results: StepResult[] = await Promise.all(
      batch.map(async (step): Promise<StepResult> => {
        try {
          const raw = await withStepSpan(step.id, step.kind, () =>
            withWallClock(step.timeout ?? runTimeoutMs(), () =>
              runStepByKind(step, ctx, deps),
            ),
          );
          const parsed = step.output.safeParse(raw);
          if (!parsed.success) {
            throw new Error(
              `step ${step.id} output failed validation: ${parsed.error.message}`,
            );
          }
          if (deps.memory) {
            await autoPersistStepOutput(deps.memory, {
              workflowId: def.id,
              stepId: step.id,
              output: parsed.data,
              persist: step.persistMemory ?? deps.persistMemory ?? true,
              at: Date.now(),
            });
          }
          return { step, value: parsed.data };
        } catch (cause) {
          return { step, error: cause as Error };
        }
      }),
    );

    for (const r of results) {
      if ('error' in r) {
        const policy = r.step.onError ?? 'fail';
        if (policy === 'fail') {
          failure = {
            kind: 'failed',
            failedStep: r.step.id,
            message: r.error.message,
          };
        } else if (policy === 'continue') {
          skipped.add(r.step.id);
        } else {
          ctx[r.step.id] = policy.fallback;
          done.add(r.step.id);
        }
        continue;
      }
      ctx[r.step.id] = r.value;
      done.add(r.step.id);
      if (r.step.kind === StepKind.Branch) {
        const taken = (r.value as { taken: string }).taken;
        const dead = taken === 'whenTrue' ? r.step.whenFalse : r.step.whenTrue;
        skipped.add(dead);
      }
    }
  }

  if (failure) return failure;
  const unverified = findUnverified(ctx);
  if (unverified) {
    return {
      kind: 'unverified',
      failedStepId: unverified.answerStepId,
      unsupportedClaims: unverified.unsupportedClaims,
      faithfulness: unverified.faithfulness,
      draft: unverified.draft,
    };
  }
  return { kind: 'done', output: ctx };
}
