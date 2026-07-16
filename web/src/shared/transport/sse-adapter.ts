import {
  RespondRequestSchema,
  type StatusEvent,
  StatusEventSchema,
} from '@contracts';
import { type ZodType, z } from 'zod';
import { ApiError, apiFetch, sessionToken } from '../contract/client.ts';
import type { ChatTransport } from './types.ts';

const OkSchema = z.object({ ok: z.boolean() });

/** Splits a raw SSE byte stream into `{ id, data }` frames (blank-line delimited). */
function parseSseFrame(
  frame: string,
): { id: string | undefined; data: string } | undefined {
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) {
      id = line.slice(3).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
    // comments (`:`) and other fields (`event:`, `retry:`) are ignored — the
    // port only needs the resumable id + the JSON payload.
  }
  if (dataLines.length === 0) return undefined;
  return { id, data: dataLines.join('\n') };
}

/** Reads a fetch `Response` body as a stream of parsed SSE frames. */
async function* readSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ id: string | undefined; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSseFrame(frame);
        if (parsed) yield parsed;
        sep = buffer.indexOf('\n\n');
      }
    }
    // flush a trailing frame with no closing blank line
    const parsed = parseSseFrame(buffer);
    if (parsed) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Fetch-based `ChatTransport` (spec D14). Native `EventSource` can't set the
 * `Authorization` header, so `stream()` uses raw `fetch` + a hand-rolled SSE
 * frame reader with `Last-Event-ID` resume support instead.
 *
 * `stream()` targets a run-scoped resume endpoint (`/api/runs/:id/stream`) —
 * the primary shape per the port contract (resumable server→client with a
 * cursor). When no `runId` is given it falls back to `/api/chat` (the plain
 * chat stream). Note: the live Phase-2 chat flow actually rides
 * `@ai-sdk/react`'s `useChat` + `DefaultChatTransport` (Task 13); this adapter
 * is the port implementation for resume/respond + future WS, per plan.
 */
export function createSseTransport(): ChatTransport {
  return {
    async *stream<T = StatusEvent>(
      runId?: string,
      fromCursor?: string | null,
      schema?: ZodType<T>,
      signal?: AbortSignal,
    ): AsyncIterable<T & { eventId: string }> {
      const payloadSchema = (schema ?? StatusEventSchema) as ZodType<T>;
      const path = runId ? `/api/runs/${runId}/stream` : '/api/chat';
      const res = await fetch(path, {
        signal,
        headers: {
          Authorization: `Bearer ${sessionToken()}`,
          Accept: 'text/event-stream',
          ...(fromCursor ? { 'Last-Event-ID': fromCursor } : {}),
        },
      });
      if (!res.ok || !res.body) {
        throw new ApiError(`stream request to ${path} failed`, res.status);
      }

      for await (const frame of readSseStream(res.body)) {
        const parsed = payloadSchema.parse(JSON.parse(frame.data));
        const eventId = frame.id ?? '';
        yield { ...(parsed as object), eventId } as T & { eventId: string };
      }
    },

    async respond(runId, payload) {
      RespondRequestSchema.parse(payload);
      await apiFetch(`/runs/${runId}/respond`, {
        method: 'POST',
        body: payload,
        schema: OkSchema,
      });
    },
  };
}

/**
 * POST-body SSE stream (Phase 5): unlike `createSseTransport().stream()`
 * (GET-only, hardcoded to `/api/runs/:id/stream` or `/api/chat`), the
 * builder-build route (and, later, mcp-test-mount) is a POST that carries a
 * JSON body and streams its response. Reuses the same frame reader
 * (`readSseStream`) so the wire format stays identical; no `runId`-based path
 * selection since the caller already knows its own path.
 *
 * The response is an AI-SDK UI-message stream (`createUIMessageStreamResponse`
 * server-side — see `src/server/builders/build.ts`), which always terminates
 * with a raw `data: [DONE]\n\n` sentinel line (`JsonToSseTransformStream`'s
 * `flush`). That line is NOT JSON — `JSON.parse('[DONE]')` throws — so it is
 * detected and skipped here rather than fed to `schema.parse`.
 */
export async function* postSseStream<T>(
  path: string,
  body: unknown,
  schema: ZodType<T>,
  signal?: AbortSignal,
): AsyncGenerator<T & { eventId: string }> {
  const res = await fetch(path, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${sessionToken()}`,
      Accept: 'text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new ApiError(`stream request to ${path} failed`, res.status);
  }
  for await (const frame of readSseStream(res.body)) {
    if (frame.data === '[DONE]') continue; // terminal sentinel, not a payload
    const parsed = schema.parse(JSON.parse(frame.data));
    yield { ...(parsed as object), eventId: frame.id ?? '' } as T & {
      eventId: string;
    };
  }
}
