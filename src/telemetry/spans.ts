import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { currentDelegationContext } from '../core/guardrails.ts';
import { recordIoEnabled } from './provider.ts';

export const ATTR = {
  RUN_ID: 'agent.run.id',
  TASK: 'agent.task',
  OUTCOME: 'agent.outcome',
  GAP_MISSING: 'agent.gap.missing_capability',
  DELEGATION_TARGET: 'agent.delegation.target',
  MODEL_ID: 'gen_ai.request.model',
  MODEL_PROVIDER: 'gen_ai.provider.name',
  MODEL_PARAMS_B: 'model.params_billions',
  MODEL_NUM_CTX: 'model.num_ctx',
  MODEL_REQUESTED_CTX: 'model.requested_num_ctx',
  MODEL_WEIGHTS_BYTES: 'model.weights_bytes',
  MODEL_KV_F16_PER_TOKEN: 'model.kv_f16_bytes_per_token',
  MODEL_KV_BYTES_PER_TOKEN: 'model.kv_bytes_per_token',
  MODEL_KV_CACHE_TYPE: 'model.kv_cache_type',
  MODEL_FOOTPRINT_BYTES: 'model.footprint_bytes',
  MODEL_BUDGET_BYTES: 'model.budget_bytes',
  MODEL_SIZE_BYTES: 'model.size_bytes',
  EVICT_REASON: 'model.evict.reason',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  GUARDRAIL_TYPE: 'agent.guardrail.type',
  DELEGATION_DEPTH: 'agent.delegation.depth',
  DELEGATION_ANCESTORS: 'agent.delegation.ancestors',
  WORKFLOW_ID: 'workflow.id',
  WORKFLOW_OUTCOME: 'workflow.outcome',
  STEP_ID: 'workflow.step.id',
  STEP_KIND: 'workflow.step.kind',
  STEP_BRANCH_TAKEN: 'workflow.step.branch.taken',
  STEP_MAP_COUNT: 'workflow.step.map.count',
  CREW_ID: 'crew.id',
  CREW_PROCESS: 'crew.process',
  CREW_TASK_MEMBER: 'crew.task.member',
  MEMORY_SPACE: 'memory.space',
  MEMORY_NAMESPACE: 'memory.namespace',
  MEMORY_CANDIDATES: 'memory.candidates',
  MEMORY_RETURNED: 'memory.returned',
  MEMORY_RERANKED: 'memory.reranked',
  MEMORY_EMBED_MODEL: 'memory.embed_model',
} as const;

export type ModelSelectInfo = {
  modelId: string;
  provider: string;
  numCtx: number;
  paramsBillions?: number;
};

export type ModelLoadInfo = {
  weightsBytes: number;
  kvF16PerToken: number;
  kvEffectivePerToken: number;
  kvCacheType: string;
  chosenCtx: number;
  requestedCtx: number;
  footprintBytes: number;
  budgetBytes: number;
};

const tracer = () => trace.getTracer('agent');

async function inSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

export function withRunSpan<T>(
  runId: string,
  task: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('agent.run', async (span) => {
    span.setAttribute(ATTR.RUN_ID, runId);
    if (recordIoEnabled()) span.setAttribute(ATTR.TASK, task);
    return fn();
  });
}

export function setRunOutcome(result: {
  kind: string;
  message?: string;
  missingCapability?: string;
}): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttribute(ATTR.OUTCOME, result.kind);
  if (result.kind === 'gap' && result.missingCapability) {
    span.setAttribute(ATTR.GAP_MISSING, result.missingCapability);
  }
  if (result.kind === 'resource') {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: result.message ?? 'resource error',
    });
  }
}

export function withDelegationSpan<T>(
  target: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('agent.delegation', async (span) => {
    const { depth, ancestors } = currentDelegationContext();
    span.setAttribute(ATTR.DELEGATION_TARGET, target);
    span.setAttribute(ATTR.DELEGATION_DEPTH, depth + 1);
    span.setAttribute(
      ATTR.DELEGATION_ANCESTORS,
      [...ancestors, target].join(' → '),
    );
    return fn();
  });
}

export function recordModelSelect(info: ModelSelectInfo): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('agent.model.select', {
    [ATTR.MODEL_ID]: info.modelId,
    [ATTR.MODEL_PROVIDER]: info.provider,
    'gen_ai.system': info.provider,
    [ATTR.MODEL_NUM_CTX]: info.numCtx,
    ...(info.paramsBillions !== undefined
      ? { [ATTR.MODEL_PARAMS_B]: info.paramsBillions }
      : {}),
  });
}

export function withModelLoadSpan<T>(
  modelId: string,
  info: ModelLoadInfo,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('agent.model.load', async (span) => {
    span.setAttribute(ATTR.MODEL_ID, modelId);
    span.setAttribute(ATTR.MODEL_WEIGHTS_BYTES, info.weightsBytes);
    span.setAttribute(ATTR.MODEL_KV_F16_PER_TOKEN, info.kvF16PerToken);
    span.setAttribute(ATTR.MODEL_KV_BYTES_PER_TOKEN, info.kvEffectivePerToken);
    span.setAttribute(ATTR.MODEL_KV_CACHE_TYPE, info.kvCacheType);
    span.setAttribute(ATTR.MODEL_NUM_CTX, info.chosenCtx);
    span.setAttribute(ATTR.MODEL_REQUESTED_CTX, info.requestedCtx);
    span.setAttribute(ATTR.MODEL_FOOTPRINT_BYTES, info.footprintBytes);
    span.setAttribute(ATTR.MODEL_BUDGET_BYTES, info.budgetBytes);
    return fn();
  });
}

export function recordEvict(
  modelId: string,
  sizeBytes: number,
  reason: string,
): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('agent.model.evict', {
    [ATTR.MODEL_ID]: modelId,
    [ATTR.MODEL_SIZE_BYTES]: sizeBytes,
    [ATTR.EVICT_REASON]: reason,
  });
}

export function recordGuardrailViolation(
  type: 'depth_exceeded',
  detail: string,
): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('agent.guardrail.violation', {
    [ATTR.GUARDRAIL_TYPE]: type,
    'agent.guardrail.detail': detail,
  });
}

/** Root span for a workflow run. Mirrors withRunSpan but for the DAG engine. */
export function withWorkflowSpan<T>(
  workflowId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('workflow.run', async (span) => {
    span.setAttribute(ATTR.WORKFLOW_ID, workflowId);
    return fn();
  });
}

/** Span for a single workflow step, tagged with its id + kind. */
export function withStepSpan<T>(
  stepId: string,
  kind: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('workflow.step', async (span) => {
    span.setAttribute(ATTR.STEP_ID, stepId);
    span.setAttribute(ATTR.STEP_KIND, kind);
    return fn();
  });
}

/** Set extra attributes on the active step span (branch decision, map count). */
export function annotateStep(attrs: Record<string, string | number>): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
}

/** Root span for a crew run. The nested workflow.run/workflow.step (sequential)
 *  or agent.delegation (hierarchical) spans attach beneath it via active context. */
export function withCrewSpan<T>(
  crewId: string,
  process: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('crew.run', async (span) => {
    span.setAttribute(ATTR.CREW_ID, crewId);
    span.setAttribute(ATTR.CREW_PROCESS, process);
    return fn();
  });
}

export type MemoryRecallInfo = {
  space: string;
  namespace?: string;
  candidates?: number;
  returned?: number;
  reranked?: boolean;
};

/** Span for a memory recall (retrieval) call, tagged with space + candidate/return counts. */
export function withMemoryRecallSpan<T>(
  info: MemoryRecallInfo,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('memory.recall', async (span) => {
    span.setAttribute(ATTR.MEMORY_SPACE, info.space);
    if (info.namespace)
      span.setAttribute(ATTR.MEMORY_NAMESPACE, info.namespace);
    if (info.candidates != null) {
      span.setAttribute(ATTR.MEMORY_CANDIDATES, info.candidates);
    }
    if (info.returned != null)
      span.setAttribute(ATTR.MEMORY_RETURNED, info.returned);
    if (info.reranked != null)
      span.setAttribute(ATTR.MEMORY_RERANKED, info.reranked);
    return fn();
  });
}

/** Set the actual rerank outcome on the active memory.recall span, overriding
 * whatever `withMemoryRecallSpan` was seeded with. Call after the rerank
 * attempt (success or failure) so `reranked` reflects reality, not intent. */
export function recordRerankOutcome(reranked: boolean): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttribute(ATTR.MEMORY_RERANKED, reranked);
}

/** Record a rerank failure on the active span so recall degradation is
 * observable without crashing the caller. */
export function recordRerankFailure(err: unknown): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('memory.rerank_failed', {
    'error.message': err instanceof Error ? err.message : String(err),
  });
}

export type MemoryIngestInfo = {
  space: string;
  source: string;
  chunks?: number;
};

/** Span for a memory ingest (write) call, tagged with space, source, and chunk count. */
export function withMemoryIngestSpan<T>(
  info: MemoryIngestInfo,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('memory.ingest', async (span) => {
    span.setAttribute(ATTR.MEMORY_SPACE, info.space);
    span.setAttribute('memory.source', info.source);
    if (info.chunks != null) span.setAttribute('memory.chunks', info.chunks);
    return fn();
  });
}

export type MemoryEmbedInfo = {
  model: string;
  count: number;
};

/** Span for an embedding call, tagged with model id and item count. */
export function withMemoryEmbedSpan<T>(
  info: MemoryEmbedInfo,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('memory.embed', async (span) => {
    span.setAttribute(ATTR.MEMORY_EMBED_MODEL, info.model);
    span.setAttribute('memory.count', info.count);
    return fn();
  });
}
