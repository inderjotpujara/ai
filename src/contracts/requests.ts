import { z } from 'zod';
import { RunListItemDtoSchema } from './dto.ts';
import { ChatRole, FeedbackRating } from './enums.ts';

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
