import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { ChatRequestSchema } from '../../contracts/requests.ts';
import type { StreamSink } from '../../core/agent.ts';
import type { EventSink } from '../../core/events.ts';
import type { IngestFlags } from '../../media/ingest.ts';
import { withUiStreamSpan } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';
import type { RunChatTurn } from './run-turn.ts';
import { buildTaskFromMessages } from './task.ts';

/** `uploadsDir` is optional so existing fakes/tests that never send
 *  `uploadIds` (and so never touch upload-path resolution) don't need to
 *  supply it; the real server (`src/server/main.ts`) always sets it. */
export type ChatHandlerDeps = { runChatTurn: RunChatTurn; uploadsDir?: string };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...ISOLATION_HEADERS,
    },
  });
}

/**
 * `POST /api/chat` — parse the request, build the orchestrator `task` from
 * the message history, and stream the turn back as an AI-SDK SSE UI-message
 * stream: `StatusEvent`s become transient `data-*` parts (the enum values
 * ARE the AI-SDK data-part type names) and the orchestrator's own token
 * stream is merged straight through.
 */
export async function handleChat(
  req: Request,
  deps: ChatHandlerDeps,
): Promise<Response> {
  let body: ReturnType<typeof ChatRequestSchema.parse>;
  try {
    body = ChatRequestSchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid chat request' }, 400);
  }

  const task = buildTaskFromMessages(body.messages);

  // Media-by-reference (Task 16): the browser sends opaque ids minted by a
  // PRIOR `POST /api/upload`, never a raw filesystem path. Resolve each id
  // back to an absolute path through the SAME `confineToDir` primitive the
  // upload endpoint validates its write with — this is the read-side half of
  // that defense-in-depth pair. A bad/escaping id 400s the whole request
  // before any engine work starts (no partial media, no silent drop).
  let media: IngestFlags | undefined;
  if (body.uploadIds && body.uploadIds.length > 0) {
    if (!deps.uploadsDir) {
      return json(
        { error: 'invalid chat request: uploads are not configured' },
        400,
      );
    }
    const images: string[] = [];
    for (const uploadId of body.uploadIds) {
      try {
        images.push(confineToDir(uploadId, deps.uploadsDir));
      } catch (err) {
        if (err instanceof MediaPathError) {
          return json(
            { error: 'invalid chat request: unknown upload id' },
            400,
          );
        }
        throw err;
      }
    }
    media = {
      images,
      audios: [],
      videos: [],
      paste: false,
      voice: false,
      voiceIn: [],
    };
  }

  // The `ui.stream` span MUST wrap the work INSIDE `execute` — not the outer
  // handler body. `createUIMessageStream` does NOT await its `execute`
  // callback, so an outer wrap would return (building the Response) in ~1
  // tick and fire the span's `finally` before the turn ran, recording
  // `{chunks:0, outcome:'unknown'}` for every latency-bearing request. Inside
  // `execute`, the span brackets the awaited `runChatTurn` (which drains the
  // orchestrator stream via `consumeStream()` before resolving), so the
  // span's `finally` records the real outcome + status-event chunk count.
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      await withUiStreamSpan({ route: '/api/chat' }, async (rec) => {
        const events: EventSink = (e) => {
          writer.write({ type: e.type, data: e, transient: true });
          // Best-effort: this counts status-event writes only. The merged
          // orchestrator token stream isn't per-chunk observable here without
          // an extra tap on the ReadableStream passed to `streamSink` — that
          // instrumentation is deferred (documented, not implemented).
          rec.chunk(JSON.stringify(e).length);
        };
        const streamSink: StreamSink = (s) => writer.merge(s);
        try {
          const result = await deps.runChatTurn({
            task,
            media,
            events,
            stream: streamSink,
            signal: req.signal,
          });
          rec.outcome(result.kind);
        } catch (err) {
          rec.outcome('error');
          // Re-throw so `createUIMessageStream` emits its own typed error
          // chunk into the stream (no silent drop, no double-handling here).
          throw err;
        }
      });
    },
    onError: (err) =>
      `stream error: ${err instanceof Error ? err.message : String(err)}`,
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { ...ISOLATION_HEADERS, 'cache-control': 'no-store' },
  });
}
