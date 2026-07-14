import { z } from 'zod';
import { DegradeKind, ModelLoadAction, StatusEventType } from './enums.ts';

export const RunStartEventSchema = z.object({
  type: z.literal(StatusEventType.RunStart),
  runId: z.string(),
  task: z.string().optional(),
});

export const ProvisionEventSchema = z.object({
  type: z.literal(StatusEventType.Provision),
  phase: z.string(),
  model: z.string().optional(),
});

export const McpMountEventSchema = z.object({
  type: z.literal(StatusEventType.McpMount),
  server: z.string(),
  outcome: z.string(),
});

export const DelegationEventSchema = z.object({
  type: z.literal(StatusEventType.Delegation),
  agent: z.string(),
  depth: z.number(),
  parentAgent: z.string().optional(),
  ancestors: z.array(z.string()),
});

export const ModelSelectEventSchema = z.object({
  type: z.literal(StatusEventType.ModelSelect),
  agent: z.string(),
  model: z.string(),
  numCtx: z.number().optional(),
  footprintBytes: z.number().optional(),
  install: z.boolean().optional(),
  degraded: z.boolean().optional(),
});

export const ModelLoadEventSchema = z.object({
  type: z.literal(StatusEventType.ModelLoad),
  model: z.string(),
  action: z.enum(ModelLoadAction),
});

export const DegradeEventSchema = z.object({
  type: z.literal(StatusEventType.Degrade),
  kind: z.enum(DegradeKind),
  subject: z.string(),
  reason: z.string(),
  spanId: z.string().optional(),
});

/**
 * `kind` is a free string, not an enum: consent kinds come from many engine
 * seams (mcp-mount, provision, build, reuse, archive, gen-download, clone, mic,
 * disk-shortfall…) and grow per future slice, so a closed enum would churn.
 */
export const ConfirmEventSchema = z.object({
  type: z.literal(StatusEventType.Confirm),
  promptId: z.string(),
  kind: z.string(),
  question: z.string(),
});

export const RunEndEventSchema = z.object({
  type: z.literal(StatusEventType.RunEnd),
  runId: z.string(),
  outcome: z.string(),
});

export const StatusEventSchema = z.discriminatedUnion('type', [
  RunStartEventSchema,
  ProvisionEventSchema,
  McpMountEventSchema,
  DelegationEventSchema,
  ModelSelectEventSchema,
  ModelLoadEventSchema,
  DegradeEventSchema,
  ConfirmEventSchema,
  RunEndEventSchema,
]);
export type StatusEvent = z.infer<typeof StatusEventSchema>;
