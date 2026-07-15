import { z } from 'zod';
import {
  ArtifactKind,
  ChatRole,
  CrewProcess,
  DegradeKind,
  RunKind,
  RunLifecycle,
  RunOrigin,
  SpanStatus,
  StepKind,
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
