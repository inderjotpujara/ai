import type { ToolSet } from 'ai';
import type { Agent } from '../core/agent-def.ts';
import { type BeforeDelegate, runGuardedAgent } from '../core/delegate.ts';
import { WorkflowError } from '../core/errors.ts';
import type { MemoryStore } from '../memory/store.ts';
import { MemoryKind } from '../memory/types.ts';
import { breakerFor } from '../reliability/breaker.ts';
import { type DegradationLedger, DegradeKind } from '../reliability/ledger.ts';
import { withRetry } from '../reliability/retry.ts';
import {
  ATTR,
  annotateStep,
  recordDegrade,
  withToolSpan,
} from '../telemetry/spans.ts';
import type { CheckpointStore } from './checkpoint.ts';
import {
  type MapSubStep,
  type Step,
  StepKind,
  type WorkflowContext,
} from './types.ts';

/** Conservative thrash-avoidance hint; the model manager's live-RAM budget is the
 *  real safety guard. Override per-map via `maxParallel` or via AGENT_WORKFLOW_MAX_PARALLEL. */
export const DEFAULT_MAX_PARALLEL = Number(
  process.env.AGENT_WORKFLOW_MAX_PARALLEL ?? 2,
);

export type WorkflowDeps = {
  /** Run a named agent with a task; returns its (already conciseness-capped) text.
   *  Default impl resolves from an agent map and goes through runGuardedAgent. */
  runAgentStep: (agentName: string, task: string) => Promise<string>;
  /** The mounted tool set (MCP + built-ins) tool steps call into. */
  tools: ToolSet;
  /** Engine-wide concurrency cap; defaults to DEFAULT_MAX_PARALLEL. */
  maxParallel?: number;
  /** Optional long-term memory store. When set, each completed+validated step's
   *  output is auto-persisted (namespace = workflow id) unless the step opts out. */
  memory?: MemoryStore;
  /** Default persist-on-completion policy when `memory` is set; a step may
   *  override via its own `persistMemory` flag. Default true. */
  persistMemory?: boolean;
  /** Optional re-recall used by Verify corrective ops (rewrite → re-recall →
   *  re-answer). Undefined = corrective retrieval is skipped (re-answer only). */
  recall?: (query: string) => Promise<unknown[]>;
  /** Optional degradation ledger; when set, a Tool step that retries records a
   *  Retried event (in addition to the telemetry span event). */
  ledger?: DegradationLedger;
  /** Optional per-run checkpoint store (Slice 24 Incr 6, D5 fallback). When set,
   *  the engine seeds `done`/`ctx` from already-checkpointed nodes at start (so a
   *  re-enqueue of the same runId skips them with NO re-execution) and records
   *  each node as it completes. Absent = runs as today (no durable resume). */
  checkpoint?: CheckpointStore;
};

/** Auto-write a completed step's output to memory, namespaced by workflow id.
 *  No-op when `store` is absent or `persist` is false; skips empty output;
 *  stringifies non-string output. */
export async function autoPersistStepOutput(
  store: MemoryStore | undefined,
  info: {
    workflowId: string;
    stepId: string;
    output: unknown;
    persist: boolean;
    at: number;
  },
): Promise<void> {
  if (!store || !info.persist) return;
  const text =
    typeof info.output === 'string' ? info.output : JSON.stringify(info.output);
  if (!text.trim()) return;
  await store.remember(text, {
    space: 'default',
    namespace: info.workflowId,
    kind: MemoryKind.RunMemory,
    source: `${info.workflowId}:${info.stepId}`,
    at: info.at,
  });
}

/** Default runAgentStep: resolve the agent by name, run it through the shared
 *  guarded path; a guard/agent error becomes a thrown WorkflowError (the engine
 *  then applies the step's onError policy). */
export function defaultRunAgentStep(
  agents: Record<string, Agent>,
  onBeforeDelegate?: BeforeDelegate,
  ledger?: DegradationLedger,
): WorkflowDeps['runAgentStep'] {
  return async (agentName, task) => {
    const agent = agents[agentName];
    if (!agent) throw new WorkflowError(`unknown agent: ${agentName}`);
    const result = await runGuardedAgent(
      agent,
      task,
      onBeforeDelegate,
      undefined,
      ledger,
    );
    if ('error' in result) throw new WorkflowError(result.error);
    return result.text;
  };
}

/** Bounded-concurrency map preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      // Safe: i < items.length is the loop invariant just checked above.
      out[i] = await fn(items[i] as T, i);
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

function callTool(
  tool: ToolSet[string],
  args: unknown,
  callId: string,
): Promise<unknown> {
  return (tool.execute as (a: unknown, o: unknown) => Promise<unknown>)(args, {
    toolCallId: callId,
    messages: [],
  });
}

async function runLeaf(
  sub: MapSubStep,
  ctx: WorkflowContext,
  deps: WorkflowDeps,
  callId: string,
): Promise<unknown> {
  if (sub.kind === StepKind.Agent) {
    return deps.runAgentStep(sub.agent, sub.input(ctx));
  }
  const tool = deps.tools[sub.tool];
  if (!tool?.execute) throw new WorkflowError(`unknown tool: ${sub.tool}`);
  return withToolSpan(sub.tool, () => callTool(tool, sub.input(ctx), callId));
}

/** Dispatch a step to its kind runner. Returns the RAW result; the engine
 *  validates it against the step's output schema. */
export function runStepByKind(
  step: Step,
  ctx: WorkflowContext,
  deps: WorkflowDeps,
): Promise<unknown> {
  switch (step.kind) {
    case StepKind.Agent:
      return deps.runAgentStep(step.agent, step.input(ctx));
    case StepKind.Tool: {
      const tool = deps.tools[step.tool];
      if (!tool?.execute) {
        return Promise.reject(new WorkflowError(`unknown tool: ${step.tool}`));
      }
      const guarded = () =>
        breakerFor(`tool:${step.tool}`).run(() =>
          withToolSpan(step.tool, () =>
            callTool(tool, step.input(ctx), step.id),
          ),
        );
      return step.retry
        ? withRetry(guarded, {
            onRetry: (n) => {
              const event = {
                kind: DegradeKind.Retried,
                subject: `tool:${step.tool}`,
                reason: `retry attempt ${n}`,
                detail: `step=${step.id}`,
                attempts: n,
              };
              deps.ledger?.record(event);
              recordDegrade(event);
            },
          })
        : guarded();
    }
    case StepKind.Branch: {
      const taken = step.predicate(ctx) ? 'whenTrue' : 'whenFalse';
      annotateStep({ [ATTR.STEP_BRANCH_TAKEN]: taken });
      return Promise.resolve({ taken });
    }
    case StepKind.Verify:
      // The op's behavior is fully captured in its closure; the engine just runs
      // it, handing back the deps it may need (agent re-run / re-recall).
      return step.run(ctx, {
        runAgentStep: deps.runAgentStep,
        recall: deps.recall,
      });
    case StepKind.Map: {
      const items = step.over(ctx);
      annotateStep({ [ATTR.STEP_MAP_COUNT]: items.length });
      const limit =
        step.maxParallel ?? deps.maxParallel ?? DEFAULT_MAX_PARALLEL;
      return mapWithConcurrency(items, limit, async (item, index) => {
        const subCtx: WorkflowContext = { ...ctx, item, index };
        const callId = `${step.id}[${index}]`;
        const raw = await runLeaf(step.step, subCtx, deps, callId);
        const parsed = step.step.output.safeParse(raw);
        if (!parsed.success) {
          throw new WorkflowError(
            `map ${step.id}[${index}] output invalid: ${parsed.error.message}`,
          );
        }
        return parsed.data;
      });
    }
  }
}
