import {
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { currentDelegationContext } from '../core/guardrails.ts';
import type { RuntimeKind } from '../core/types.ts';
import { contentPolicyLabel } from '../media/consent.ts';
import { uncensoredEnabled } from '../media/policy.ts';
import { type DegradeEvent, DegradeKind } from '../reliability/ledger.ts';
import type { ArtifactKind, VerifiedLevel } from '../verified-build/types.ts';
import type { CaptureSource } from '../voice/types.ts';
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
  /** Slice 30b Phase 6 (D6) — whether a `rememberOnce` auto-ingest call was
   *  a dedup no-op. */
  MEMORY_REMEMBER_SKIPPED: 'memory.remember.skipped',
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
  MCP_AUTH_OUTCOME: 'mcp.auth.outcome',
  MCP_AUTH_KIND: 'mcp.auth.kind',
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
  // Runtime warm/spawn (Slice 26)
  RUNTIME_KIND: 'runtime.kind',
  RUNTIME_CONTEXT_CAPABILITY: 'runtime.context.capability',
  RUNTIME_CONTEXT_REQUESTED: 'runtime.context.requested',
  RUNTIME_CONTEXT_APPLIED: 'runtime.context.applied',
  RUNTIME_WARM_OUTCOME: 'runtime.warm.outcome',
  // Multimodal analysis (Slice 27)
  INPUT_MODALITY: 'gen_ai.input.modality',
  CONTENT_POLICY: 'content.policy',
  MEDIA_TRANSCRIBE_MODEL: 'media.transcribe.model',
  MEDIA_TRANSCRIBE_AUDIO_SECONDS: 'media.transcribe.audio_seconds',
  MEDIA_TRANSCRIBE_DURATION_MS: 'media.transcribe.duration_ms',
  MEDIA_TRANSCRIBE_OUTCOME: 'media.transcribe.outcome',
  MEDIA_FRAMES_FPS: 'media.frames.fps',
  MEDIA_FRAMES_SAMPLED: 'media.frames.sampled',
  MEDIA_FRAMES_DURATION_MS: 'media.frames.duration_ms',
  MEDIA_GENERATE_KIND: 'media.generate.kind',
  MEDIA_GENERATE_ENGINE: 'media.generate.engine',
  MEDIA_GENERATE_MODEL: 'media.generate.model',
  MEDIA_GENERATE_EXEC_MODE: 'media.generate.exec_mode',
  MEDIA_GENERATE_DURATION_MS: 'media.generate.duration_ms',
  MEDIA_GENERATE_SIZE_BYTES: 'media.generate.size_bytes',
  MEDIA_GENERATE_OUTCOME: 'media.generate.outcome',
  GEN_FIT_CHOSEN: 'media.gen_fit.chosen',
  GEN_FIT_FITS: 'media.gen_fit.fits',
  GEN_FIT_BUDGET_BYTES: 'media.gen_fit.budget_bytes',
  GEN_FIT_MODEL_BYTES: 'media.gen_fit.model_bytes',
  GEN_FIT_CANDIDATES: 'media.gen_fit.candidates',
  // Voice input (Slice 29)
  VOICE_STT_MODEL: 'voice.stt.model',
  VOICE_CAPTURE_SOURCE: 'voice.capture.source',
  VOICE_AUDIO_SECONDS: 'voice.audio.seconds',
  VOICE_DURATION_MS: 'voice.duration.ms',
  VOICE_OUTCOME: 'voice.outcome',
  VOICE_WORD_COUNT: 'voice.word.count',
  VOICE_REAL_TIME_FACTOR: 'voice.real_time_factor',
  VOICE_ENGINE: 'voice.engine',
  // Server / web BFF (Slice 30b)
  SERVER_ROUTE: 'server.route',
  SERVER_METHOD: 'http.request.method',
  SERVER_STATUS: 'http.response.status_code',
  SERVER_DURATION_MS: 'server.duration_ms',
  /** Request principal/owner; reserved "local" now, upgrades to audit-grade in Slice 35. */
  SERVER_PRINCIPAL: 'server.principal',
  UI_STREAM_CHUNKS: 'ui.stream.chunks',
  UI_STREAM_BYTES: 'ui.stream.bytes',
  UI_STREAM_RESUMES: 'ui.stream.resumes',
  UI_STREAM_OUTCOME: 'ui.stream.outcome',
  // Live run-stream SSE (Slice 30b Phase 3): GET /api/runs/:id/stream
  RUN_STREAM_CHUNKS: 'run.stream.chunks',
  RUN_STREAM_BYTES: 'run.stream.bytes',
  RUN_STREAM_RESUMES: 'run.stream.resumes',
  RUN_STREAM_OUTCOME: 'run.stream.outcome',
  RUN_STREAM_RUN_ID: 'run.stream.run_id',
  // Chat feedback (Slice 30b Phase 2; Slice 31 consumes it for the eval loop)
  FEEDBACK_MESSAGE_ID: 'chat.feedback.message_id',
  FEEDBACK_RATING: 'chat.feedback.rating',
  // Model pull (Slice 30b Phase 5, §7.2)
  MODEL_PULL_RUNTIME: 'model.pull.runtime',
  MODEL_PULL_MODEL_REF: 'model.pull.model_ref',
  MODEL_PULL_OUTCOME: 'model.pull.outcome',
  MODEL_PULL_PHASE: 'model.pull.progress.phase',
  MODEL_PULL_PERCENT: 'model.pull.progress.percent',
  MODEL_PULL_BYTES_COMPLETED: 'model.pull.progress.bytes_completed',
  MODEL_PULL_BYTES_TOTAL: 'model.pull.progress.bytes_total',
  MODEL_PULL_SPEED_BPS: 'model.pull.progress.speed_bytes_per_sec',
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
    span.setAttribute(
      ATTR.CONTENT_POLICY,
      contentPolicyLabel(uncensoredEnabled()),
    );
    if (recordIoEnabled()) span.setAttribute(ATTR.TASK, task);
    return fn();
  });
}

/**
 * Root span for one CHAT turn (Slice 30b Phase 8, D9). A `chat.run`-naming
 * sibling of `withRunSpan` with an identical body — chat turns stop borrowing
 * the generic `agent.run` name so `deriveRunKind` classifies them as
 * `RunKind.Chat` (and the web notifier never toasts a long chat turn). Kept
 * separate rather than reusing `withRunSpan` so a future standalone-agent-run
 * feature still owns the `agent.run` name.
 */
export function withChatRunSpan<T>(
  runId: string,
  task: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('chat.run', async (span) => {
    span.setAttribute(ATTR.RUN_ID, runId);
    span.setAttribute(
      ATTR.CONTENT_POLICY,
      contentPolicyLabel(uncensoredEnabled()),
    );
    if (recordIoEnabled()) span.setAttribute(ATTR.TASK, task);
    return fn();
  });
}

/**
 * Span for one HTTP request handled by the web BFF (Slice 30b). Follows the
 * recorder-callback pattern (`withRuntimeSpan`): opens a `server.request` span,
 * sets route/method + the reserved principal, runs `fn` (which reports the final
 * status via `rec.status`), records the duration in a `finally`, and — via
 * `inSpan` — records an error status if `fn` throws.
 */
export function withServerRequestSpan<T>(
  info: { route: string; method: string; principal?: string },
  fn: (rec: { status: (code: number) => void }) => Promise<T>,
): Promise<T> {
  return inSpan('server.request', async (span) => {
    const startedAt = performance.now();
    span.setAttribute(ATTR.SERVER_ROUTE, info.route);
    span.setAttribute(ATTR.SERVER_METHOD, info.method);
    span.setAttribute(ATTR.SERVER_PRINCIPAL, info.principal ?? 'local');
    try {
      return await fn({
        status: (code) => span.setAttribute(ATTR.SERVER_STATUS, code),
      });
    } finally {
      span.setAttribute(
        ATTR.SERVER_DURATION_MS,
        Math.round(performance.now() - startedAt),
      );
    }
  });
}

/**
 * Span for one SSE chat stream session (Slice 30b Phase 2). Follows the
 * recorder-callback pattern (`withRuntimeSpan`/`withGenerateSpan`): opens a
 * `ui.stream` span, sets the route, runs `fn` (which reports chunks/bytes as
 * they're written, resumes on reconnect, and the final outcome), and records
 * the aggregates in a `finally` so they land on the span even if `fn` throws.
 */
export function withUiStreamSpan<T>(
  info: { route: string },
  fn: (rec: {
    chunk: (bytes: number) => void;
    resume: () => void;
    outcome: (o: string) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('ui.stream', async (span) => {
    span.setAttribute(ATTR.SERVER_ROUTE, info.route);
    let chunks = 0;
    let bytes = 0;
    let resumes = 0;
    let outcome = 'unknown';
    try {
      return await fn({
        chunk: (b) => {
          chunks += 1;
          bytes += b;
        },
        resume: () => {
          resumes += 1;
        },
        outcome: (o) => {
          outcome = o;
        },
      });
    } finally {
      span.setAttribute(ATTR.UI_STREAM_CHUNKS, chunks);
      span.setAttribute(ATTR.UI_STREAM_BYTES, bytes);
      span.setAttribute(ATTR.UI_STREAM_RESUMES, resumes);
      span.setAttribute(ATTR.UI_STREAM_OUTCOME, outcome);
    }
  });
}

/**
 * Span for one live run-stream SSE session (Slice 30b Phase 3):
 * `GET /api/runs/:id/stream`. Mirrors `withUiStreamSpan`'s recorder-callback
 * shape — opens a `runs.stream` span, tags route + run id, runs `fn` (which
 * reports each SSE frame's bytes, a resume on reconnect, and the final
 * outcome), and records the aggregates in a `finally` so they land even if
 * `fn` throws.
 */
export function withRunStreamSpan<T>(
  info: { route: string; runId: string },
  fn: (rec: {
    chunk: (bytes: number) => void;
    resume: () => void;
    outcome: (o: string) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('runs.stream', async (span) => {
    span.setAttribute(ATTR.SERVER_ROUTE, info.route);
    span.setAttribute(ATTR.RUN_STREAM_RUN_ID, info.runId);
    let chunks = 0;
    let bytes = 0;
    let resumes = 0;
    let outcome = 'unknown';
    try {
      return await fn({
        chunk: (b) => {
          chunks += 1;
          bytes += b;
        },
        resume: () => {
          resumes += 1;
        },
        outcome: (o) => {
          outcome = o;
        },
      });
    } finally {
      span.setAttribute(ATTR.RUN_STREAM_CHUNKS, chunks);
      span.setAttribute(ATTR.RUN_STREAM_BYTES, bytes);
      span.setAttribute(ATTR.RUN_STREAM_RESUMES, resumes);
      span.setAttribute(ATTR.RUN_STREAM_OUTCOME, outcome);
    }
  });
}

/**
 * One-shot span for `POST /api/feedback` (Slice 30b Phase 2): records the
 * 👍/👎 on a chat message as its own `chat.feedback` span (no parent request
 * span carries useful attributes here, unlike `withServerRequestSpan`).
 * Slice 31 will query these spans to close the eval loop — this is just the
 * telemetry seam, no consumer yet.
 */
export function recordChatFeedback(info: {
  messageId: string;
  rating: string;
}): Promise<void> {
  return inSpan('chat.feedback', async (span) => {
    span.setAttribute(ATTR.FEEDBACK_MESSAGE_ID, info.messageId);
    span.setAttribute(ATTR.FEEDBACK_RATING, info.rating);
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

/** Record the gen-fit selection decision on the active span (mirrors
 *  recordDegrade). No-op when there is no active span. */
export function recordGenFit(info: {
  kind: string;
  chosen?: string;
  fits: boolean;
  budgetBytes: number;
  modelBytes?: number;
  candidates: number;
}): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('media.gen_fit', {
    [ATTR.MEDIA_GENERATE_KIND]: info.kind,
    [ATTR.GEN_FIT_FITS]: info.fits,
    [ATTR.GEN_FIT_BUDGET_BYTES]: info.budgetBytes,
    [ATTR.GEN_FIT_CANDIDATES]: info.candidates,
    ...(info.chosen ? { [ATTR.GEN_FIT_CHOSEN]: info.chosen } : {}),
    ...(info.modelBytes !== undefined
      ? { [ATTR.GEN_FIT_MODEL_BYTES]: info.modelBytes }
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

export type MemoryRememberInfo = { space: string; namespace?: string };

/** Span for one `rememberOnce` auto-ingest call (Slice 30b Phase 6, D6):
 *  unlike `withMemoryIngestSpan` (whose caller checks `seenDoc` BEFORE
 *  opening the span, so a dedup-skip never appears in the trace at all),
 *  this span wraps the WHOLE call including the dedup check — the
 *  `skipped` attribute is what makes "how often does chat auto-ingest
 *  dedup-skip" answerable straight from spans, since chat callers never
 *  pre-check `seenDoc` themselves. */
export function withMemoryRememberSpan<T extends { skipped: boolean }>(
  info: MemoryRememberInfo,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('memory.remember', async (span) => {
    span.setAttribute(ATTR.MEMORY_SPACE, info.space);
    if (info.namespace) {
      span.setAttribute(ATTR.MEMORY_NAMESPACE, info.namespace);
    }
    const result = await fn();
    span.setAttribute(ATTR.MEMORY_REMEMBER_SKIPPED, result.skipped);
    return result;
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

export type ModelPullSpanInfo = { runtime: string; modelRef: string };

/** Root span for one model download (Slice 30b Phase 5, §7.2). Stays open for
 *  the WHOLE download so `model.pull.progress` ticks (below) nest under it
 *  via OTel active-context propagation — the same mechanism `withStepSpan`
 *  relies on nesting under `crew.run`/`workflow.run`. The body reports the
 *  terminal outcome via the returned recorder; a thrown `fn` marks the span
 *  ERROR via `inSpan`'s own catch, same as every other root-span helper. */
export function withModelPullSpan<T>(
  info: ModelPullSpanInfo,
  fn: (rec: { outcome: (o: string) => void }) => Promise<T>,
): Promise<T> {
  return inSpan('model.pull', async (span) => {
    span.setAttribute(ATTR.MODEL_PULL_RUNTIME, info.runtime);
    span.setAttribute(ATTR.MODEL_PULL_MODEL_REF, info.modelRef);
    return fn({
      outcome: (o) => span.setAttribute(ATTR.MODEL_PULL_OUTCOME, o),
    });
  });
}

export type PullProgressTick = {
  phase: string;
  percent: number | null;
  bytesCompleted: number;
  bytesTotal: number | null;
  speedBytesPerSec: number | null;
};

/** One short-lived child span per `DownloadProgress` tick (§7.2's fix for
 *  "nothing renders until the download finishes": `JsonlFileExporter` only
 *  appends a span when THAT span closes, and `model.pull`'s root stays open
 *  for the whole download). MUST be called from inside `withModelPullSpan`'s
 *  `fn` (or a descendant of it) so active-context propagation nests it under
 *  the open root. Opens and closes synchronously within one call; safe under
 *  rapid/concurrent ticks (`inSpan`'s `finally { span.end() }` ends THIS
 *  call's own span instance regardless of any other in-flight tick). */
export function recordPullProgressTick(p: PullProgressTick): Promise<void> {
  return inSpan('model.pull.progress', async (span) => {
    span.setAttribute(ATTR.MODEL_PULL_PHASE, p.phase);
    if (p.percent !== null)
      span.setAttribute(ATTR.MODEL_PULL_PERCENT, p.percent);
    span.setAttribute(ATTR.MODEL_PULL_BYTES_COMPLETED, p.bytesCompleted);
    if (p.bytesTotal !== null) {
      span.setAttribute(ATTR.MODEL_PULL_BYTES_TOTAL, p.bytesTotal);
    }
    if (p.speedBytesPerSec !== null) {
      span.setAttribute(ATTR.MODEL_PULL_SPEED_BPS, p.speedBytesPerSec);
    }
  });
}

/** Span for one engine-level tool call (StepKind.Tool) — closes the gap where
 *  direct tool dispatch ran uninstrumented (agent-internal tool calls are
 *  already covered by the AI-SDK telemetry integration, `telemetry.ai-sdk.ts`). */
export function withToolSpan<T>(
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('workflow.tool', async (span) => {
    span.setAttribute(ATTR.TOOL_NAME, toolName);
    return fn();
  });
}

/** Root span for an MCP mount pass; the body records one event per server
 *  (via `record`) plus, for HTTP entries, one auth-determination event per
 *  server (via `recordAuth`) on the same span. `recordAuth` never receives
 *  secret values — only the server name and the auth kind/outcome enums. */
export function withMcpMountSpan<T>(
  fn: (
    record: (
      name: string,
      outcome: string,
      toolCount?: number,
      transport?: string,
    ) => void,
    recordAuth: (name: string, kind: string, outcome: string) => void,
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
    const recordAuth = (name: string, kind: string, outcome: string): void => {
      span.addEvent('mcp.server.auth', {
        [ATTR.MCP_SERVER]: name,
        [ATTR.MCP_AUTH_KIND]: kind,
        [ATTR.MCP_AUTH_OUTCOME]: outcome,
      });
    };
    const out = await fn(record, recordAuth);
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

/** Root span for one runtime warm/spawn call (Slice 26). Mirrors
 *  withCrewBuildSpan's recorder shape: the body reports the requested vs.
 *  applied context window, the runtime's context capability, and the warm
 *  outcome at the end via the returned recorder. `appliedCtx` should be
 *  `undefined` for `fixed`-capability runtimes (e.g. MLX) so the attribute
 *  is omitted rather than implying a context change actually happened. */
export function withRuntimeSpan<T>(
  kind: RuntimeKind,
  fn: (rec: {
    applied: (
      requestedCtx: number | undefined,
      appliedCtx: number | undefined,
      outcome: string,
      capability: string,
    ) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('runtime.warm', async (span) => {
    span.setAttribute(ATTR.RUNTIME_KIND, kind);
    return fn({
      applied: (requestedCtx, appliedCtx, outcome, capability) => {
        span.setAttribute(ATTR.RUNTIME_CONTEXT_CAPABILITY, capability);
        if (requestedCtx !== undefined) {
          span.setAttribute(ATTR.RUNTIME_CONTEXT_REQUESTED, requestedCtx);
        }
        if (appliedCtx !== undefined) {
          span.setAttribute(ATTR.RUNTIME_CONTEXT_APPLIED, appliedCtx);
        }
        span.setAttribute(ATTR.RUNTIME_WARM_OUTCOME, outcome);
      },
    });
  });
}

export type TranscribeSpanInfo = {
  model: string;
  audioSeconds?: number;
  durationMs?: number;
  outcome?: string;
};

/** Root span for one audio transcription call (Slice 27). Seeds the model and
 *  any pre-known attrs (audio length, duration, outcome) up-front, mirroring
 *  withProvisionSpan; callers that only learn `durationMs`/`outcome` after
 *  the work completes can pass the span through via the returned `fn(span)`
 *  and set attributes directly. */
export function withTranscribeSpan<T>(
  info: TranscribeSpanInfo,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return inSpan('media.transcribe', async (span) => {
    span.setAttribute(ATTR.MEDIA_TRANSCRIBE_MODEL, info.model);
    span.setAttribute(ATTR.INPUT_MODALITY, 'audio');
    if (info.audioSeconds !== undefined) {
      span.setAttribute(ATTR.MEDIA_TRANSCRIBE_AUDIO_SECONDS, info.audioSeconds);
    }
    if (info.durationMs !== undefined) {
      span.setAttribute(ATTR.MEDIA_TRANSCRIBE_DURATION_MS, info.durationMs);
    }
    if (info.outcome !== undefined) {
      span.setAttribute(ATTR.MEDIA_TRANSCRIBE_OUTCOME, info.outcome);
    }
    return fn(span);
  });
}

export type VoiceSpanInfo = { model: string; source: CaptureSource };

/** Root span for one voice-input transcription call (Slice 29). Sets the STT
 *  model and capture source (mic vs file) up-front, mirroring
 *  withTranscribeSpan; callers that only learn `durationMs`/`outcome` after
 *  the work completes can pass the span through via the returned `fn(span)`
 *  and set attributes directly. */
export function withVoiceTranscribeSpan<T>(
  info: VoiceSpanInfo,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return inSpan('voice.transcribe', async (span) => {
    span.setAttribute(ATTR.VOICE_STT_MODEL, info.model);
    span.setAttribute(ATTR.VOICE_CAPTURE_SOURCE, info.source);
    span.setAttribute(ATTR.INPUT_MODALITY, 'audio');
    return fn(span);
  });
}

/**
 * Fire-and-forget span for one BROWSER voice transcription (Slice 30b Phase 8,
 * D10). Written server-side by `POST /api/telemetry` (`src/server/telemetry/`)
 * from the client's `navigator.sendBeacon` call — distinct from the in-process
 * CLI-side `voice.transcribe` span (`withVoiceTranscribeSpan` above): it carries
 * the browser-only `wordCount`/`realTimeFactor`/`engine`, not capture-source /
 * audio-seconds / outcome. No parent request span carries useful attributes here,
 * so it opens its own root (mirrors `recordChatFeedback`).
 */
export function recordVoiceTranscribeWeb(info: {
  modelTier: string;
  durationMs: number;
  wordCount: number;
  realTimeFactor: number;
  engine: string;
}): Promise<void> {
  return inSpan('voice.transcribe.web', async (span) => {
    span.setAttribute(ATTR.VOICE_STT_MODEL, info.modelTier);
    span.setAttribute(ATTR.VOICE_DURATION_MS, info.durationMs);
    span.setAttribute(ATTR.VOICE_WORD_COUNT, info.wordCount);
    span.setAttribute(ATTR.VOICE_REAL_TIME_FACTOR, info.realTimeFactor);
    span.setAttribute(ATTR.VOICE_ENGINE, info.engine);
    span.setAttribute(ATTR.INPUT_MODALITY, 'audio');
  });
}

export type FrameSampleSpanInfo = {
  fps: number;
  framesSampled?: number;
  durationMs?: number;
};

/** Root span for one video frame-sampling call (Slice 27). Seeds the fps and
 *  any pre-known attrs (frames sampled, duration) up-front, mirroring
 *  withProvisionSpan. */
export function withFrameSampleSpan<T>(
  info: FrameSampleSpanInfo,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return inSpan('media.frames', async (span) => {
    span.setAttribute(ATTR.MEDIA_FRAMES_FPS, info.fps);
    span.setAttribute(ATTR.INPUT_MODALITY, 'video');
    if (info.framesSampled !== undefined) {
      span.setAttribute(ATTR.MEDIA_FRAMES_SAMPLED, info.framesSampled);
    }
    if (info.durationMs !== undefined) {
      span.setAttribute(ATTR.MEDIA_FRAMES_DURATION_MS, info.durationMs);
    }
    return fn(span);
  });
}

export type GenerateSpanInfo = {
  kind: string;
  engine: string;
  model?: string;
  execMode: string;
};

/** Root span for one media-generation call (Slice 27). Seeds kind/engine/
 *  model/execMode up-front, mirroring `withProvisionSpan`; the body reports
 *  outcome/duration/size at settle time via the returned recorder, mirroring
 *  `withRuntimeSpan`'s recorder-callback shape. This fits the one-shot job's
 *  async lifecycle: `runOneShotJob` returns a `JobHandle` synchronously while
 *  the spawn→exit→store work settles later, so the recorder is called from
 *  wherever that later settlement happens rather than from a return value. */
export function withGenerateSpan<T>(
  info: GenerateSpanInfo,
  fn: (rec: {
    done: (outcome: string, durationMs: number, sizeBytes?: number) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('media.generate', async (span) => {
    span.setAttribute(ATTR.MEDIA_GENERATE_KIND, info.kind);
    span.setAttribute(ATTR.MEDIA_GENERATE_ENGINE, info.engine);
    if (info.model !== undefined) {
      span.setAttribute(ATTR.MEDIA_GENERATE_MODEL, info.model);
    }
    span.setAttribute(ATTR.MEDIA_GENERATE_EXEC_MODE, info.execMode);
    return fn({
      done: (outcome, durationMs, sizeBytes) => {
        span.setAttribute(ATTR.MEDIA_GENERATE_OUTCOME, outcome);
        span.setAttribute(ATTR.MEDIA_GENERATE_DURATION_MS, durationMs);
        if (sizeBytes !== undefined) {
          span.setAttribute(ATTR.MEDIA_GENERATE_SIZE_BYTES, sizeBytes);
        }
      },
    });
  });
}
