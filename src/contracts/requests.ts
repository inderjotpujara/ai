import { z } from 'zod';
import {
  CrewListItemDtoSchema,
  McpServerDtoSchema,
  MemorySpaceDtoSchema,
  ModelInventoryDtoSchema,
  RetrievalResultDtoSchema,
  RunListItemDtoSchema,
  WorkflowListItemDtoSchema,
} from './dto.ts';
import {
  BuilderKind,
  ChatRole,
  FeedbackRating,
  RunKind,
  RuntimeKind,
} from './enums.ts';

/**
 * A minimal, structural UIMessage-like shape. We deliberately do NOT import
 * AI-SDK's UIMessage type (Slice 23 forward-compat). The Phase-2 chat handler
 * `await convertToModelMessages(...)` (async in AI SDK v6.0.217) on the parsed
 * value; Phase 1 only validates the wire body before any engine call.
 */
export const UiMessagePartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

export const UiMessageLikeSchema = z.object({
  id: z.string(),
  role: z.enum(ChatRole),
  parts: z.array(UiMessagePartSchema),
});
export type UiMessageLike = z.infer<typeof UiMessageLikeSchema>;

export const ChatRequestSchema = z.object({
  messages: z.array(UiMessageLikeSchema),
  sessionId: z.string().optional(),
  /** Ids returned by a prior `POST /api/upload` (Slice 30b Phase 2, Task 16)
   *  — media-by-reference: the browser never sends a raw filesystem path,
   *  only the opaque id the upload endpoint minted. */
  uploadIds: z.array(z.string()).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** `POST /api/upload` response (Slice 30b Phase 2, Task 16): the server-minted
 *  opaque filename for a confined, validated image upload. */
export const UploadResponseSchema = z.object({ uploadId: z.string() });
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const RespondRequestSchema = z.object({
  promptId: z.string(),
  value: z.unknown(),
});
export type RespondRequest = z.infer<typeof RespondRequestSchema>;

/** `POST /api/feedback` — thumbs up/down on a chat message (Slice 30b Phase 2). */
export const FeedbackRequestSchema = z.object({
  messageId: z.string(),
  rating: z.enum(FeedbackRating),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

/** `GET /api/runs?search=&outcome=&degraded=&limit=&cursor=` query. Values are
 *  raw query strings, so `limit`/`degraded` coerce; `limit` carries a default. */
export const RunListQuerySchema = z.object({
  search: z.string().optional(),
  outcome: z.string().optional(),
  degraded: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  kind: z.enum(RunKind).optional(),
  limit: z.coerce.number().int().positive().max(200).default(25),
  cursor: z.string().optional(),
});
export type RunListQuery = z.infer<typeof RunListQuerySchema>;

/** `GET /api/runs` response — a page of run summaries + a cursor when more remain. */
export const RunListResponseSchema = z.object({
  items: z.array(RunListItemDtoSchema),
  nextCursor: z.string().optional(),
  total: z.number(),
});
export type RunListResponse = z.infer<typeof RunListResponseSchema>;

/** `POST /api/crews/:name/run` and `POST /api/workflows/:id/run` body. The
 *  `.max(100_000)` bounds the perimeter — these routes go live in Phase 4
 *  Task 12 and there is otherwise no body-size cap at this layer. */
export const CrewRunRequestSchema = z.object({
  input: z.string().max(100_000),
});
export type CrewRunRequest = z.infer<typeof CrewRunRequestSchema>;
export const WorkflowRunRequestSchema = z.object({
  input: z.string().max(100_000),
});
export type WorkflowRunRequest = z.infer<typeof WorkflowRunRequestSchema>;

/** Launch response — the minted runId the browser opens the watch stream for. */
export const RunLaunchResponseSchema = z.object({ runId: z.string() });
export type RunLaunchResponse = z.infer<typeof RunLaunchResponseSchema>;

/** Browse list responses — plain arrays (small in-memory registries, no cursor). */
export const CrewListResponseSchema = z.object({
  items: z.array(CrewListItemDtoSchema),
});
export type CrewListResponse = z.infer<typeof CrewListResponseSchema>;
export const WorkflowListResponseSchema = z.object({
  items: z.array(WorkflowListItemDtoSchema),
});
export type WorkflowListResponse = z.infer<typeof WorkflowListResponseSchema>;

/** `POST /api/builders/build` body (spec §4.2.1). `need.max(20_000)` bounds
 *  the perimeter the same way `CrewRunRequestSchema` bounds `input` (Phase 4). */
export const BuilderBuildRequestSchema = z.object({
  kind: z.enum(BuilderKind),
  need: z.string().max(20_000),
  autoYes: z.boolean().optional(),
  force: z.boolean().optional(),
});
export type BuilderBuildRequest = z.infer<typeof BuilderBuildRequestSchema>;

/** `POST /api/models/pull` body (spec §4.2.4). No `provider` field — the
 *  server resolves which `DownloadProvider` to use from its own catalog
 *  lookup (never trusts the client to pick the download mechanism). */
export const ModelPullRequestSchema = z.object({
  runtime: z.enum(RuntimeKind),
  modelRef: z.string().min(1),
});
export type ModelPullRequest = z.infer<typeof ModelPullRequestSchema>;

/** `POST /api/memory/:space/recall` body (spec §4.2.5). `space` is a path
 *  param on the real route, not this body — kept here too (optional) so the
 *  schema is reusable if a future caller posts a bare query without a path
 *  param (e.g. an internal test harness). */
export const MemoryRecallRequestSchema = z.object({
  query: z.string().min(1),
  space: z.string().optional(),
  topK: z.number().int().positive().optional(),
});
export type MemoryRecallRequest = z.infer<typeof MemoryRecallRequestSchema>;

/** `POST /api/mcp/add` body (spec §4.2.6) — the raw `mcpServers.<name>` value,
 *  mirroring `PackEntry.server` (`src/mcp/types.ts:84`). */
export const McpAddRequestSchema = z.object({
  name: z.string().min(1),
  server: z.record(z.string(), z.unknown()),
});
export type McpAddRequest = z.infer<typeof McpAddRequestSchema>;

/** Browse/list responses — plain arrays (small in-memory/on-disk sets, no
 *  cursor), mirroring `CrewListResponseSchema`/`WorkflowListResponseSchema`
 *  (Phase 4). */
export const ModelListResponseSchema = z.object({
  items: z.array(ModelInventoryDtoSchema),
});
export type ModelListResponse = z.infer<typeof ModelListResponseSchema>;

export const MemorySpaceListResponseSchema = z.object({
  items: z.array(MemorySpaceDtoSchema),
});
export type MemorySpaceListResponse = z.infer<
  typeof MemorySpaceListResponseSchema
>;

export const RetrievalResponseSchema = z.object({
  items: z.array(RetrievalResultDtoSchema),
});
export type RetrievalResponse = z.infer<typeof RetrievalResponseSchema>;

export const McpListResponseSchema = z.object({
  items: z.array(McpServerDtoSchema),
});
export type McpListResponse = z.infer<typeof McpListResponseSchema>;

/** Shared by `GET /api/builders/agents` and `GET /api/builders/crews` — both
 *  are a bare list of registry names (existing-agent awareness for the
 *  wizard), not a projected DTO array. */
export const BuilderRegistryListResponseSchema = z.object({
  items: z.array(z.string()),
});
export type BuilderRegistryListResponse = z.infer<
  typeof BuilderRegistryListResponseSchema
>;
