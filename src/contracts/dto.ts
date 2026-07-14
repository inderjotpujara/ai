import { z } from 'zod';
import {
  ArtifactKind,
  ChatRole,
  DegradeKind,
  RunLifecycle,
  RunOrigin,
  SpanStatus,
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

export const ChatMessageDtoSchema = z.object({
  id: z.string(),
  role: z.enum(ChatRole),
  text: z.string(),
  /** Slice 37 taint/trust marker. */
  degraded: z.boolean().optional(),
});
export type ChatMessageDTO = z.infer<typeof ChatMessageDtoSchema>;
