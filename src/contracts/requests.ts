import { z } from 'zod';
import {
  CrewListItemDtoSchema,
  McpServerDtoSchema,
  ModelInventoryDtoSchema,
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
 *  param (e.g. an internal test harness). Bounded the same way
 *  `BuilderBuildRequestSchema.need`/`McpAddRequestSchema` bound their
 *  perimeters (Phase 4/5): `query.max(4_000)` is generous for a natural-
 *  language recall question (a full paragraph, not a document — well under
 *  the `20_000` ceiling used for free-text bodies elsewhere) while still
 *  finite; `topK.max(50)` caps how many ranked chunks a single recall can
 *  request — `retrieve()` (`src/memory/retrieve.ts:74`) fetches
 *  `topK * 4` candidates from LanceDB per call, so an unbounded `topK` is a
 *  resource-exhaustion vector (Phase 5 T6 review: unbounded `query`/`topK`). */
export const MemoryRecallRequestSchema = z.object({
  query: z.string().min(1).max(4_000),
  space: z.string().optional(),
  topK: z.number().int().positive().max(50).optional(),
});
export type MemoryRecallRequest = z.infer<typeof MemoryRecallRequestSchema>;

/** `POST /api/memory/:space/ingest` body — the ALREADY-UPLOADED file's opaque
 *  id (the Phase-2 `/api/upload` id pattern, `<32 hex>.ext`), never a raw
 *  filesystem path (Phase 5 FORK-3: ingest reads only confined uploaded
 *  bytes, mirroring the D17 fix that disabled `ingestMedia`'s server-side
 *  `autoDetectPaths`). `.max(256)` bounds the string well above any real
 *  upload id so an unbounded client value never reaches `confineToDir`/fs. */
export const MemoryIngestRequestSchema = z.object({
  fileId: z.string().min(1).max(256),
});
export type MemoryIngestRequest = z.infer<typeof MemoryIngestRequestSchema>;

/** `POST /api/memory/:space/ingest` response — projects `MemoryStore.ingest`'s
 *  actual return shape (`src/memory/store.ts:119`, `Promise<{ chunks: number;
 *  skipped: boolean }>`) onto the wire, matching every sibling response
 *  schema's idiom (`UploadResponseSchema`, `RunLaunchResponseSchema`) so T29's
 *  web Memory tab has a single source of truth to parse against instead of an
 *  untyped store passthrough (Phase 5 T27 review). The `:space/recall` and
 *  `:space/spaces` routes deliberately return BARE arrays per spec §4.2 (no
 *  `{items}` wrapper), so no `RetrievalResponseSchema`/
 *  `MemorySpaceListResponseSchema` exists — they were removed in the Phase 5
 *  final review as orphan/unused. */
export const MemoryIngestResponseSchema = z.object({
  chunks: z.number(),
  skipped: z.boolean(),
});
export type MemoryIngestResponse = z.infer<typeof MemoryIngestResponseSchema>;

/** `POST /api/mcp/add` body (spec §4.2.6) — the raw `mcpServers.<name>` value,
 *  mirroring `PackEntry.server` (`src/mcp/types.ts:84`). Bounded the same way
 *  `BuilderBuildRequestSchema.need` bounds its perimeter (Phase 4): `name` has
 *  no existing length convention elsewhere in `src/mcp/`, so `.max(128)` is a
 *  generous-but-finite cap; `server` gets a `.superRefine` on its serialized
 *  size (not a keyed-count check — a server value can legitimately have a few
 *  keys with one huge one, e.g. a long `args` array or `env` blob) capped at
 *  the same `20_000`-char perimeter as `BuilderBuildRequestSchema.need`, so a
 *  single `POST /api/mcp/add` can't grow/wedge the shared `mcp.json` that
 *  `doWrite` (`src/mcp/write.ts`) `JSON.stringify`s it into (Phase 5 T22
 *  review: unbounded input to a shared persistent file). */
export const McpAddRequestSchema = z.object({
  name: z.string().min(1).max(128),
  server: z.record(z.string(), z.unknown()).superRefine((server, ctx) => {
    if (JSON.stringify(server).length > 20_000) {
      ctx.addIssue({
        code: 'custom',
        message: 'server value exceeds 20,000-character serialized size cap',
      });
    }
  }),
});
export type McpAddRequest = z.infer<typeof McpAddRequestSchema>;

/** Browse/list responses — plain arrays (small in-memory/on-disk sets, no
 *  cursor), mirroring `CrewListResponseSchema`/`WorkflowListResponseSchema`
 *  (Phase 4). */
export const ModelListResponseSchema = z.object({
  items: z.array(ModelInventoryDtoSchema),
});
export type ModelListResponse = z.infer<typeof ModelListResponseSchema>;

export const McpListResponseSchema = z.object({
  items: z.array(McpServerDtoSchema),
});
export type McpListResponse = z.infer<typeof McpListResponseSchema>;

/** `POST /api/mcp/test-mount` body — the config-entry name to verify. */
export const McpTestMountRequestSchema = z.object({ name: z.string() });
export type McpTestMountRequest = z.infer<typeof McpTestMountRequestSchema>;

/** Shared by `GET /api/builders/agents` and `GET /api/builders/crews` — both
 *  are a bare list of registry names (existing-agent awareness for the
 *  wizard), not a projected DTO array. */
export const BuilderRegistryListResponseSchema = z.object({
  items: z.array(z.string()),
});
export type BuilderRegistryListResponse = z.infer<
  typeof BuilderRegistryListResponseSchema
>;
