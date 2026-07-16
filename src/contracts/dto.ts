import { z } from 'zod';
import {
  ArtifactKind,
  ChatRole,
  CrewProcess,
  DegradeKind,
  McpAuthKind,
  McpServerStatus,
  McpTransportKind,
  RunKind,
  RunLifecycle,
  RunOrigin,
  RuntimeKind,
  SpanStatus,
  StepKind,
  VerifiedLevel,
} from './enums.ts';

/** Optional token roll-up; mapper tolerates absence (telemetry gap #1). */
const TokensSchema = z
  .object({ input: z.number().optional(), output: z.number().optional() })
  .optional();

export const DegradeDtoSchema = z.object({
  kind: z.enum(DegradeKind),
  label: z.string(),
  subject: z.string(),
  reason: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  attempts: z.number().optional(),
  lane: z.string().optional(),
  spanId: z.string().optional(),
});
export type DegradeDTO = z.infer<typeof DegradeDtoSchema>;

export const SpanDtoSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  offsetMs: z.number(),
  durationMs: z.number(),
  depth: z.number(),
  status: z.enum(SpanStatus),
  statusMessage: z.string().optional(),
  agent: z.string().optional(),
  delegation: z
    .object({
      target: z.string(),
      depth: z.number(),
      ancestors: z.array(z.string()),
    })
    .optional(),
  model: z
    .object({
      id: z.string(),
      provider: z.string().optional(),
      numCtx: z.number().optional(),
      footprintBytes: z.number().optional(),
      runtimeDegraded: z.boolean().optional(),
    })
    .optional(),
  tokens: TokensSchema,
  degraded: z.boolean(),
  /** Reserved for Slices 31/38 (node/location). */
  node: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()),
  events: z.array(
    z.object({
      name: z.string(),
      offsetMs: z.number(),
      attributes: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});
export type SpanDTO = z.infer<typeof SpanDtoSchema>;

export const RunDtoSchema = z.object({
  id: z.string(),
  /** Reserved now, constant "local"; backfilling ownership later (Slices 24/33). */
  owner: z.string(),
  origin: z.enum(RunOrigin),
  kind: z.enum(RunKind),
  lifecycle: z.enum(RunLifecycle),
  startMs: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
  models: z.array(z.string()),
  contentPolicy: z.string().optional(),
  tokens: TokensSchema,
  degraded: z.boolean(),
  degrades: z.array(DegradeDtoSchema),
  malformedSpans: z.number(),
  spanCount: z.number(),
  roots: z.array(z.string()),
  spans: z.array(SpanDtoSchema),
  artifacts: z.array(
    z.object({
      name: z.string(),
      bytes: z.number(),
      kind: z.enum(ArtifactKind),
    }),
  ),
});
export type RunDTO = z.infer<typeof RunDtoSchema>;

/** Lightweight list summary — no `spans`/`artifacts`/`degrades` (that is the
 *  whole point of the mtime summary cache; Slice 30b Phase 3, Layer ②). */
export const RunListItemDtoSchema = z.object({
  id: z.string(),
  startMs: z.number(),
  durationMs: z.number(),
  outcome: z.string(),
  lifecycle: z.enum(RunLifecycle),
  origin: z.enum(RunOrigin),
  kind: z.enum(RunKind),
  models: z.array(z.string()),
  degraded: z.boolean(),
  spanCount: z.number(),
  tokens: TokensSchema,
});
export type RunListItemDTO = z.infer<typeof RunListItemDtoSchema>;

export const ChatMessageDtoSchema = z.object({
  id: z.string(),
  role: z.enum(ChatRole),
  text: z.string(),
  /** Slice 37 taint/trust marker. */
  degraded: z.boolean().optional(),
});
export type ChatMessageDTO = z.infer<typeof ChatMessageDtoSchema>;

/** Projected crew member — prompt scaffolding + selection policy only. The
 *  engine's `tools: ToolSet` is dropped (not JSON-serializable). `requires`/
 *  `prefer` are the raw capability/policy strings (Capability/PreferPolicy
 *  values); kept as strings on the wire — the browser only displays them. */
export const CrewMemberDtoSchema = z.object({
  name: z.string(),
  role: z.string(),
  goal: z.string(),
  backstory: z.string(),
  requires: z.array(z.string()),
  prefer: z.string(),
  agentRef: z.string().optional(),
});
export type CrewMemberDTO = z.infer<typeof CrewMemberDtoSchema>;

/** Projected crew task — the `output: z.ZodType` schema is dropped (not
 *  serializable); `verify` surfaces the grounded-verification opt-in. */
export const CrewTaskDtoSchema = z.object({
  id: z.string(),
  description: z.string(),
  expectedOutput: z.string(),
  member: z.string(),
  dependsOn: z.array(z.string()),
  verify: z.boolean().optional(),
});
export type CrewTaskDTO = z.infer<typeof CrewTaskDtoSchema>;

export const CrewListItemDtoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  process: z.enum(CrewProcess),
  memberCount: z.number(),
  taskCount: z.number(),
});
export type CrewListItemDTO = z.infer<typeof CrewListItemDtoSchema>;

export const CrewDetailDtoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  process: z.enum(CrewProcess),
  members: z.array(CrewMemberDtoSchema),
  tasks: z.array(CrewTaskDtoSchema),
});
export type CrewDetailDTO = z.infer<typeof CrewDetailDtoSchema>;

/** A projected workflow step — closures (`input`/`predicate`/`over`/`run`) and
 *  the `output: z.ZodType` are dropped; only display + structure remain. Branch
 *  targets and the map sub-step kind are surfaced so the DAG can render control
 *  flow. */
export const StepDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(StepKind),
  agent: z.string().optional(),
  tool: z.string().optional(),
  onError: z.string().optional(),
  retry: z.boolean().optional(),
  verify: z.boolean().optional(),
  branch: z.object({ whenTrue: z.string(), whenFalse: z.string() }).optional(),
  map: z.object({ subKind: z.enum(StepKind) }).optional(),
});
export type StepDTO = z.infer<typeof StepDtoSchema>;

/** A DAG edge. `depends` edges come from `effectiveDeps`; `branch-*` edges from
 *  a BranchStep's whenTrue/whenFalse (rendered distinctly / dashed). */
export const EdgeDtoSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['depends', 'branch-true', 'branch-false']),
});
export type EdgeDTO = z.infer<typeof EdgeDtoSchema>;

export const WorkflowListItemDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  stepCount: z.number(),
});
export type WorkflowListItemDTO = z.infer<typeof WorkflowListItemDtoSchema>;

export const WorkflowDetailDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  steps: z.array(StepDtoSchema),
  edges: z.array(EdgeDtoSchema),
});
export type WorkflowDetailDTO = z.infer<typeof WorkflowDetailDtoSchema>;

/** A curated-pack MCP server a proposed agent needs, scoped to that agent.
 *  Mirrors `SuggestedServer` (`src/agent-builder/types.ts:8`). */
export const SuggestedServerDtoSchema = z.object({
  packName: z.string(),
  scopeToAgent: z.string(),
});
export type SuggestedServerDTO = z.infer<typeof SuggestedServerDtoSchema>;

/** Mirrors `ModelRequirement` (`src/core/types.ts:42-49`) — `requires`/
 *  `prefer` kept as plain strings on the wire (Capability/PreferPolicy
 *  values; the browser only displays them), matching `CrewMemberDtoSchema`'s
 *  precedent (Phase 4). */
export const ModelReqDtoSchema = z.object({
  role: z.string(),
  requires: z.array(z.string()),
  prefer: z.string(),
  allowUncensored: z.boolean().optional(),
});
export type ModelReqDTO = z.infer<typeof ModelReqDtoSchema>;

/** Near-identity re-export of `AgentProposal` (`src/agent-builder/types.ts:11-18`,
 *  D5) — no closures, no ToolSet, no ZodType in the engine type either. */
export const AgentProposalDtoSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  modelReq: ModelReqDtoSchema,
  suggestedServers: z.array(SuggestedServerDtoSchema),
  rationale: z.string(),
});
export type AgentProposalDTO = z.infer<typeof AgentProposalDtoSchema>;

/** Mirrors `CrewMemberIR` (`src/crew-builder/ir.ts:86-95`) — the PROPOSAL
 *  shape (pre-build), distinct from `CrewMemberDtoSchema` (Phase 4, which
 *  projects the already-COMMITTED CrewDef member and has no `prefer` field
 *  pre-build). */
export const CrewProposalMemberDtoSchema = z.object({
  name: z.string(),
  agentRef: z.string().optional(),
  role: z.string(),
  goal: z.string(),
  backstory: z.string(),
  requires: z.array(z.string()),
  tools: z.array(z.string()).optional(),
});
export type CrewProposalMemberDTO = z.infer<typeof CrewProposalMemberDtoSchema>;

/** Mirrors `CrewTaskIR` (`src/crew-builder/ir.ts:97-105`). */
export const CrewProposalTaskDtoSchema = z.object({
  id: z.string(),
  description: z.string(),
  expectedOutput: z.string(),
  member: z.string(),
  dependsOn: z.array(z.string()).optional(),
  verify: z.boolean().optional(),
});
export type CrewProposalTaskDTO = z.infer<typeof CrewProposalTaskDtoSchema>;

/** Mirrors `CrewIR` (`src/crew-builder/ir.ts:107-114`, D5) — a staged,
 *  not-yet-committed crew proposal. */
export const CrewProposalDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  process: z.enum(CrewProcess),
  members: z.array(CrewProposalMemberDtoSchema),
  tasks: z.array(CrewProposalTaskDtoSchema),
});
export type CrewProposalDTO = z.infer<typeof CrewProposalDtoSchema>;

/** Mirrors `WorkflowStepIR` (`src/crew-builder/ir.ts:28-77`) — drops the
 *  `input`/`predicate`/`over.ref`-as-closure-descriptor detail (execution-only,
 *  not needed for display; `over` keeps just the mapOver source-step ref as a
 *  plain string for a map step's sublabel). `dependsOn` is explicit (see the
 *  task-level design note above). */
export const WorkflowProposalStepDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(StepKind),
  agent: z.string().optional(),
  tool: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  verify: z.boolean().optional(),
  branch: z.object({ whenTrue: z.string(), whenFalse: z.string() }).optional(),
  over: z.string().optional(),
});
export type WorkflowProposalStepDTO = z.infer<
  typeof WorkflowProposalStepDtoSchema
>;

/** Mirrors `WorkflowIR` (`src/crew-builder/ir.ts:79-84`, D5). */
export const WorkflowProposalDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  steps: z.array(WorkflowProposalStepDtoSchema),
});
export type WorkflowProposalDTO = z.infer<typeof WorkflowProposalDtoSchema>;

/** A flattened tagged union mirroring `BuildResult`/`CrewBuildResult`
 *  (`src/agent-builder/types.ts:22-38`, `src/crew-builder/types.ts:13-31`) —
 *  `kind` discriminates; fields irrelevant to a given `kind` are simply
 *  absent (not a discriminated union on the wire, since both source types
 *  already agree on `kind`'s string values and this keeps the schema a
 *  single flat object the terminal SSE text part can `JSON.stringify`/parse
 *  without a second discriminated layer). */
export const BuildResultDtoSchema = z.object({
  kind: z.enum([
    'written',
    'declined',
    'invalid',
    'abandoned',
    'reused',
    'failed-verification',
  ]),
  name: z.string().optional(),
  files: z.array(z.string()).optional(),
  level: z.enum(VerifiedLevel).optional(),
  issues: z
    .array(z.object({ field: z.string(), problem: z.string() }))
    .optional(),
  reason: z.string().optional(),
  similarity: z.number().optional(),
  stage: z.string().optional(),
  detail: z.string().optional(),
  /** Present only for a `written` AGENT build (`BuildResult.written` carries
   *  the full `AgentProposal` back to the caller — `src/agent-builder/types.ts:22-28`;
   *  `CrewBuildResult.written` does NOT carry the IR, an existing engine-side
   *  gap, so this stays absent for a written crew/workflow — see Task 10's
   *  `toCrewBuildResultDto`). Lets the wizard (Task 14) render the D6
   *  post-write proposal DagView without a second round-trip. */
  proposal: z
    .union([
      AgentProposalDtoSchema,
      CrewProposalDtoSchema,
      WorkflowProposalDtoSchema,
    ])
    .optional(),
});
export type BuildResultDTO = z.infer<typeof BuildResultDtoSchema>;

/** Projected model-catalog row — installed (from `buildRegistry()`) or
 *  pullable (from the cached discovery catalog, fit-ranked). No `provider`
 *  field: which `DownloadProvider` fetches a pullable model's weights is a
 *  server-internal resolution detail (`src/server/models/pull.ts`, Task 17),
 *  never sent to the client. */
export const ModelInventoryDtoSchema = z.object({
  runtime: z.enum(RuntimeKind),
  model: z.string(),
  installed: z.boolean(),
  fits: z.boolean(),
  sizeBytes: z.number().optional(),
  shortfallBytes: z.number().optional(),
});
export type ModelInventoryDTO = z.infer<typeof ModelInventoryDtoSchema>;

/** Projected memory space, from `MemoryStore.stats(): Record<string, number>`
 *  (`src/memory/store.ts:178-183`). */
export const MemorySpaceDtoSchema = z.object({
  name: z.string(),
  chunkCount: z.number(),
});
export type MemorySpaceDTO = z.infer<typeof MemorySpaceDtoSchema>;

/** Projected recall hit. Mirrors `RetrievalResult` (`src/memory/types.ts:29-35`)
 *  minus `namespace` — deliberately dropped: the Memory tab's recall box is
 *  space-scoped already (the request's `space` param), so per-hit namespace
 *  is redundant detail the wire doesn't need. */
export const RetrievalResultDtoSchema = z.object({
  id: z.string(),
  source: z.string(),
  text: z.string(),
  score: z.number(),
});
export type RetrievalResultDTO = z.infer<typeof RetrievalResultDtoSchema>;

/** Projected MCP server entry, joining `McpConfig.entries`
 *  (`src/mcp/types.ts:72-76`) with the server-side mount-status snapshot
 *  (`src/server/mcp/`, a later increment). `status: 'dormant'` mirrors
 *  `McpConfig.dormant` (missing required env vars — never attempted). */
export const McpServerDtoSchema = z.object({
  name: z.string(),
  kind: z.enum(McpTransportKind),
  agents: z.array(z.string()).optional(),
  authKind: z.enum(McpAuthKind),
  status: z.enum(McpServerStatus),
  reason: z.string().optional(),
});
export type McpServerDTO = z.infer<typeof McpServerDtoSchema>;
