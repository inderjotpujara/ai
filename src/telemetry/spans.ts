import {
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { currentDelegationContext } from '../core/guardrails.ts';
import { type DegradeEvent, DegradeKind } from '../reliability/ledger.ts';
import type { ArtifactKind, VerifiedLevel } from '../verified-build/types.ts';
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
  MODEL_RUNTIME_SELECTED: 'model.runtime.selected',
  MODEL_RUNTIME_DEGRADED: 'model.runtime.degraded',
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
  VERIFICATION_SUPPORTED: 'verification.supported',
  VERIFICATION_FAITHFULNESS: 'verification.faithfulness',
  VERIFICATION_UNSUPPORTED: 'verification.unsupported_claims',
  VERIFICATION_CRAG_GRADE: 'verification.crag_grade',
  VERIFICATION_RETRIES: 'verification.retries',
  VERIFICATION_FALLBACK: 'verification.fallback',
  /** Distinct RuntimeKind values across the models selected for this
   *  provisioning run — the inference runtime the download will serve,
   *  not the download `ProviderKind` (see `Candidate.provider` for that). */
  PROVISION_RUNTIME: 'provision.runtime',
  PROVISION_CANDIDATE_COUNT: 'provision.candidate_count',
  PROVISION_SELECTED_COUNT: 'provision.selected_count',
  PROVISION_BYTES_TOTAL: 'provision.bytes_total',
  PROVISION_DOWNLOADED_COUNT: 'provision.downloaded_count',
  PROVISION_FAILED_COUNT: 'provision.failed_count',
  PROVISION_DEFERRED_VERIFY: 'provision.deferred_verify',
  PROVISION_SNAPSHOT_FALLBACK: 'provision.snapshot_fallback',
  TOOL_NAME: 'gen_ai.tool.name',
  MCP_SERVER: 'mcp.server',
  MCP_TRANSPORT: 'mcp.transport',
  MCP_TOOL_COUNT: 'mcp.tool.count',
  MCP_MOUNT_OUTCOME: 'mcp.mount.outcome',
  MCP_SERVER_COUNT: 'mcp.server.count',
  BUILD_NEED: 'agent.build.need',
  BUILD_AGENT: 'agent.build.agent_name',
  BUILD_OUTCOME: 'agent.build.outcome',
  BUILD_SERVERS: 'agent.build.server_count',
  CREW_BUILD_NEED: 'crew.build.need',
  CREW_BUILD_SHAPE: 'crew.build.shape',
  CREW_BUILD_ID: 'crew.build.id',
  CREW_BUILD_MEMBERS: 'crew.build.member_count',
  CREW_BUILD_STEPS: 'crew.build.step_count',
  CREW_BUILD_MEMBERS_BUILT: 'crew.build.members_built',
  CREW_BUILD_OUTCOME: 'crew.build.outcome',
  ARTIFACT_KIND: 'artifact.kind',
  VERIFY_REUSE_DECISION: 'verify.reuse.decision',
  VERIFY_REUSE_SIMILARITY: 'verify.reuse.similarity',
  VERIFY_DRYRUN_RAN: 'verify.dry_run.ran',
  VERIFY_DRYRUN_REPAIRS: 'verify.dry_run.repairs',
  VERIFY_JUDGE_MODEL: 'verify.judge.model',
  VERIFY_JUDGE_BELOW_BAR: 'verify.judge.below_bar',
  VERIFY_GOLDEN_PASSED: 'verify.golden.passed',
  VERIFY_GOLDEN_TOTAL: 'verify.golden.total',
  VERIFY_LEVEL: 'verify.level',
  ARCHIVE_CANDIDATES: 'archive.candidates',
  ARCHIVE_PRUNED: 'archive.pruned',
  // Reliability (Slice 21)
  RELIABILITY_RETRY_ATTEMPTS: 'retry.attempts',
  RELIABILITY_RETRY_LANE: 'retry.lane',
  RELIABILITY_BREAKER_STATE: 'breaker.state',
  RELIABILITY_DEGRADE_FROM: 'degrade.from',
  RELIABILITY_DEGRADE_TO: 'degrade.to',
  RELIABILITY_DEGRADE_REASON: 'degrade.reason',
  RELIABILITY_DROPPED_AGENT: 'partial_failure.dropped_agent',
  ERROR_TYPE: 'error.type',
} as const;

export type ModelSelectInfo = {
  modelId: string;
  provider: string;
  numCtx: number;
  paramsBillions?: number;
  /** The runtime that actually served the request (post-degrade, if any). */
  runtime?: string;
  /** True when the declared runtime was unreachable and selection fell back to another. */
  degraded?: boolean;
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
    ...(info.runtime !== undefined
      ? { [ATTR.MODEL_RUNTIME_SELECTED]: info.runtime }
      : {}),
    ...(info.degraded !== undefined
      ? { [ATTR.MODEL_RUNTIME_DEGRADED]: info.degraded }
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

/** Record a degradation event on the active span (mirrors recordGuardrailViolation). */
export function recordDegrade(event: DegradeEvent): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('reliability.degrade', {
    [ATTR.ERROR_TYPE]: event.kind,
    'degrade.subject': event.subject,
    [ATTR.RELIABILITY_DEGRADE_REASON]: event.reason,
    ...(event.detail ? { 'degrade.detail': event.detail } : {}),
    ...(event.from !== undefined
      ? { [ATTR.RELIABILITY_DEGRADE_FROM]: event.from }
      : {}),
    ...(event.to !== undefined
      ? { [ATTR.RELIABILITY_DEGRADE_TO]: event.to }
      : {}),
    ...(event.attempts !== undefined
      ? { [ATTR.RELIABILITY_RETRY_ATTEMPTS]: event.attempts }
      : {}),
    ...(event.lane !== undefined
      ? { [ATTR.RELIABILITY_RETRY_LANE]: event.lane }
      : {}),
    ...(event.kind === DegradeKind.AgentDropped
      ? { [ATTR.RELIABILITY_DROPPED_AGENT]: event.subject }
      : {}),
    ...(event.kind === DegradeKind.CircuitOpen
      ? { [ATTR.RELIABILITY_BREAKER_STATE]: 'Open' }
      : {}),
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

export type VerificationInfo = {
  supported?: boolean;
  faithfulness?: number;
  crag?: string;
  retries?: number;
  fallback?: boolean;
};

/** Span for a grounded-verification check, tagged with the verdict (support/faithfulness/CRAG grade) and retry/fallback outcome. */
export function withVerificationSpan<T>(
  info: VerificationInfo,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('verification.check', async (span) => {
    if (info.supported != null)
      span.setAttribute(ATTR.VERIFICATION_SUPPORTED, info.supported);
    if (info.faithfulness != null)
      span.setAttribute(ATTR.VERIFICATION_FAITHFULNESS, info.faithfulness);
    if (info.crag) span.setAttribute(ATTR.VERIFICATION_CRAG_GRADE, info.crag);
    if (info.retries != null)
      span.setAttribute(ATTR.VERIFICATION_RETRIES, info.retries);
    if (info.fallback != null)
      span.setAttribute(ATTR.VERIFICATION_FALLBACK, info.fallback);
    return fn();
  });
}

/** Record unsupported-claim count on the active verification.check span. Call
 * after the faithfulness check runs so the count reflects the actual verdict. */
export function recordVerdict(unsupportedClaims: number): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttribute(ATTR.VERIFICATION_UNSUPPORTED, unsupportedClaims);
}

export type ProvisionSpanInfo = {
  candidateCount: number;
  selectedCount: number;
  bytesTotal: number;
  snapshotFallback: boolean;
  /** Distinct RuntimeKind values (as strings) backing the selected models. */
  runtimes: string[];
};

/** Root span for a first-boot provisioning run (Slice 14). */
export function withProvisionSpan<T>(
  info: ProvisionSpanInfo,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return inSpan('agent.model.provision', async (span) => {
    span.setAttribute(ATTR.PROVISION_CANDIDATE_COUNT, info.candidateCount);
    span.setAttribute(ATTR.PROVISION_SELECTED_COUNT, info.selectedCount);
    span.setAttribute(ATTR.PROVISION_BYTES_TOTAL, info.bytesTotal);
    span.setAttribute(ATTR.PROVISION_SNAPSHOT_FALLBACK, info.snapshotFallback);
    span.setAttribute(ATTR.PROVISION_RUNTIME, info.runtimes);
    return fn(span);
  });
}

/** Span for one engine-level tool call (StepKind.Tool) — closes the gap where
 *  direct tool dispatch ran uninstrumented (agent-internal tool calls are
 *  already covered by AI-SDK experimental_telemetry). */
export function withToolSpan<T>(
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('workflow.tool', async (span) => {
    span.setAttribute(ATTR.TOOL_NAME, toolName);
    return fn();
  });
}

/** Root span for an MCP mount pass; the body records one event per server. */
export function withMcpMountSpan<T>(
  fn: (
    record: (
      name: string,
      outcome: string,
      toolCount?: number,
      transport?: string,
    ) => void,
  ) => Promise<T>,
): Promise<T> {
  return inSpan('mcp.mount', async (span) => {
    let mountedServers = 0;
    let mountedTools = 0;
    const record = (
      name: string,
      outcome: string,
      toolCount?: number,
      transport?: string,
    ): void => {
      if (outcome === 'mounted') {
        mountedServers += 1;
        mountedTools += toolCount ?? 0;
      }
      span.addEvent('mcp.server.mount', {
        [ATTR.MCP_SERVER]: name,
        [ATTR.MCP_MOUNT_OUTCOME]: outcome,
        ...(toolCount !== undefined
          ? { [ATTR.MCP_TOOL_COUNT]: toolCount }
          : {}),
        ...(transport !== undefined ? { [ATTR.MCP_TRANSPORT]: transport } : {}),
      });
    };
    const out = await fn(record);
    span.setAttribute(ATTR.MCP_SERVER_COUNT, mountedServers);
    span.setAttribute(ATTR.MCP_TOOL_COUNT, mountedTools);
    return out;
  });
}

/** Root span for one agent-builder run (Slice 17). The body records stage
 *  events (generated / validated / suggested / consent / written) and sets
 *  the outcome + counts at the end via the returned recorder. */
export function withAgentBuildSpan<T>(
  need: string,
  fn: (rec: {
    event: (
      name: string,
      attrs?: Record<string, string | number | boolean>,
    ) => void;
    outcome: (kind: string, agentName?: string, serverCount?: number) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('agent.build', async (span) => {
    span.setAttribute(ATTR.BUILD_NEED, need);
    return fn({
      event: (name, attrs) => span.addEvent(name, attrs),
      outcome: (kind, agentName, serverCount) => {
        span.setAttribute(ATTR.BUILD_OUTCOME, kind);
        if (agentName) span.setAttribute(ATTR.BUILD_AGENT, agentName);
        if (serverCount !== undefined)
          span.setAttribute(ATTR.BUILD_SERVERS, serverCount);
      },
    });
  });
}

/** Root span for one crew/workflow-builder run (Slice 19). Mirrors
 *  withAgentBuildSpan: the body records stage events (classified /
 *  generated / validated / written) and sets the outcome + member/step
 *  counts at the end via the returned recorder. */
export function withCrewBuildSpan<T>(
  need: string,
  fn: (rec: {
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
  }) => Promise<T>,
): Promise<T> {
  return inSpan('crew.build', async (span) => {
    span.setAttribute(ATTR.CREW_BUILD_NEED, need);
    return fn({
      event: (name, attrs) => span.addEvent(name, attrs),
      outcome: (kind, shape, id, count, built) => {
        span.setAttribute(ATTR.CREW_BUILD_OUTCOME, kind);
        if (shape) span.setAttribute(ATTR.CREW_BUILD_SHAPE, shape);
        if (id) span.setAttribute(ATTR.CREW_BUILD_ID, id);
        if (count !== undefined)
          span.setAttribute(
            shape === 'crew' ? ATTR.CREW_BUILD_MEMBERS : ATTR.CREW_BUILD_STEPS,
            count,
          );
        if (built !== undefined)
          span.setAttribute(ATTR.CREW_BUILD_MEMBERS_BUILT, built);
      },
    });
  });
}

/** Root span for one build-verification pass (reuse gate / dry-run / judge /
 *  golden set). Mirrors withCrewBuildSpan: the body records stage events,
 *  sets `verify.*` attributes as stages complete (via `attrs`), and sets the
 *  earned VerifiedLevel at the end via the returned recorder. */
export function withBuildVerifySpan<T>(
  kind: ArtifactKind,
  fn: (rec: {
    event(name: string, attrs?: Record<string, unknown>): void;
    attrs(attrs: Record<string, unknown>): void;
    result(level: VerifiedLevel, attrs?: Record<string, unknown>): void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('build.verify', async (span) => {
    span.setAttribute(ATTR.ARTIFACT_KIND, kind);
    return fn({
      event: (name, attrs) => span.addEvent(name, attrs as Attributes),
      attrs: (attrs) => span.setAttributes(attrs as Attributes),
      result: (level, attrs) => {
        span.setAttribute(ATTR.VERIFY_LEVEL, level);
        if (attrs) span.setAttributes(attrs as Attributes);
      },
    });
  });
}

/** Set the reuse decision + similarity on the active span (the agent.build /
 *  crew.build span at the builders' reuse-check site) so a reuse hit/offer
 *  is observable even though no build.verify span opens for it. */
export function recordReuseDecision(
  decision: string,
  similarity: number,
): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttribute(ATTR.VERIFY_REUSE_DECISION, decision);
  span.setAttribute(ATTR.VERIFY_REUSE_SIMILARITY, similarity);
}

/** Root span for one artifact-archive maintenance pass; the body reports the
 *  candidate/pruned counts at the end via the returned recorder. */
export function withBuildArchiveSpan<T>(
  fn: (rec: { done(candidates: number, pruned: number): void }) => Promise<T>,
): Promise<T> {
  return inSpan('build.archive', async (span) => {
    return fn({
      done: (candidates, pruned) => {
        span.setAttribute(ATTR.ARCHIVE_CANDIDATES, candidates);
        span.setAttribute(ATTR.ARCHIVE_PRUNED, pruned);
      },
    });
  });
}
