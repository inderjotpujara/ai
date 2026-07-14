import { z } from 'zod';
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
