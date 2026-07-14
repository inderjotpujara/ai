import { z } from 'zod';
import { ChatRole } from './enums.ts';

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
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const RespondRequestSchema = z.object({
  promptId: z.string(),
  value: z.unknown(),
});
export type RespondRequest = z.infer<typeof RespondRequestSchema>;
