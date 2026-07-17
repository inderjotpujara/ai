import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { ChatRole, StatusEventType } from '../../contracts/enums.ts';
import { ChatRequestSchema } from '../../contracts/requests.ts';
import type { StreamSink } from '../../core/agent.ts';
import type { EventSink } from '../../core/events.ts';
import type { IngestFlags } from '../../media/ingest.ts';
import type { SessionStore } from '../../session/store.ts';
import { withUiStreamSpan } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';
import type { RunChatTurn } from './run-turn.ts';
import { buildTaskFromMessages, latestUserMessage, textOf } from './task.ts';

/** `uploadsDir` is optional so existing fakes/tests that never send
 *  `uploadIds` (and so never touch upload-path resolution) don't need to
 *  supply it; the real server (`src/server/main.ts`) always sets it.
 *  `sessionStore` is optional for the identical reason: pre-existing chat
 *  tests that never exercise persistence keep passing untouched, while the
 *  real server always supplies one (Slice 30b Phase 6, D3/D4). */
export type ChatHandlerDeps = {
  runChatTurn: RunChatTurn;
  uploadsDir?: string;
  sessionStore?: SessionStore;
};

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
 *
 * Turn-boundary persistence (Slice 30b Phase 6, D3/D4/D7, spec §7.1): when
 * `sessionId` + `sessionStore` are both present, the user's ask is upserted
 * and appended HERE, in this function's own synchronous body — well before
 * `createUIMessageStream` (and so before the Response, and any first token,
 * ever exist), which is what satisfies §7.1(a). The assistant's answer
 * persists later, inside `execute`'s `try` block, only once
 * `deps.runChatTurn(...)` has actually resolved — reusing the SAME `result`
 * value the stream-outcome branch already computes, no extra stream tap; a
 * thrown/aborted turn skips straight to `catch`, so the assistant row is
 * simply never written (§7.1(b)/(e) — a deliberate, visible gap, not
 * silent data loss). See `tests/server/chat-handler-persistence.test.ts`
 * for the adversarially-verified requirements (§7.1 a–e).
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
  const sessionId = body.sessionId;
  const lastUserMsg = latestUserMessage(body.messages);

  // Turn-boundary persistence, part 1 of 2 (D3/D4, §7.1(a)/(c)): the user's
  // ask is durably written BEFORE any engine work starts — this whole block
  // is plain synchronous code in `handleChat`'s own body, not inside
  // `execute`, so nothing below this point can produce output before these
  // calls have returned. `upsertSession`'s `INSERT OR IGNORE` (§7.1(c)) and
  // `appendMessage`'s `INSERT OR IGNORE` on `msg.id` make a retried request
  // for the SAME sessionId/message a safe no-op, never a constraint-
  // violation throw.
  if (sessionId && deps.sessionStore) {
    const startedAt = Date.now();
    deps.sessionStore.upsertSession(sessionId, {
      defaultTitle:
        (lastUserMsg ? textOf(lastUserMsg) : '').slice(0, 80) || 'New chat',
      at: startedAt,
    });
    if (lastUserMsg) {
      deps.sessionStore.appendMessage(
        sessionId,
        {
          id: lastUserMsg.id,
          role: lastUserMsg.role,
          parts: lastUserMsg.parts,
        },
        startedAt,
      );
    }
  }

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
        // D7: tapped alongside the existing status-event write below — a
        // Degrade event marks the WHOLE turn degraded (never un-marked by a
        // later event); RunStart's runId is captured the same way so the
        // persisted assistant row can carry it (closes Increment 1's
        // flagged `sessions.run_id`-never-written gap, via T21's extension).
        let degradedThisTurn = false;
        let capturedRunId: string | undefined;
        const events: EventSink = (e) => {
          writer.write({ type: e.type, data: e, transient: true });
          // Best-effort: this counts status-event writes only. The merged
          // orchestrator token stream isn't per-chunk observable here without
          // an extra tap on the ReadableStream passed to `streamSink` — that
          // instrumentation is deferred (documented, not implemented).
          rec.chunk(JSON.stringify(e).length);
          if (e.type === StatusEventType.Degrade) degradedThisTurn = true;
          if (e.type === StatusEventType.RunStart) capturedRunId = e.runId;
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
          // For 'answer', the text already streamed token-by-token via
          // `streamSink`/`writer.merge` above — nothing more to write. For
          // 'gap'/'resource', the orchestrator only SYNTHESIZES `result.message`
          // AFTER generation finishes (see `runOrchestrator`), so nothing has
          // reached the stream yet; without this, the browser renders an empty
          // assistant bubble (the CLI doesn't have this gap — it prints
          // `result.message` directly). Write it as a one-shot text part.
          const assistantText =
            result.kind === 'answer' ? result.text : result.message;
          if (result.kind !== 'answer') {
            const id = `outcome-${result.kind}`;
            writer.write({ type: 'text-start', id });
            writer.write({ type: 'text-delta', id, delta: assistantText });
            writer.write({ type: 'text-end', id });
          }
          // Turn-boundary persistence, part 2 of 2 (D3/D4/D7, §7.1(b)/(e)):
          // reached ONLY after `runChatTurn` has actually resolved — a throw
          // above (caught below) skips this entirely, so a dropped
          // connection/turn leaves the assistant row simply absent, never
          // partial. The assistant message's id is server-minted: the AI-SDK
          // client mints its own display id independently, so there is no
          // client-generated id available here to reuse (this same id is
          // what Increment 3/T30's `rememberOnce` source string is built
          // from, keeping every turn's auto-ingest dedup key unique).
          const assistantMsgId = `asst-${crypto.randomUUID()}`;
          if (sessionId && deps.sessionStore) {
            deps.sessionStore.appendMessage(
              sessionId,
              {
                id: assistantMsgId,
                role: ChatRole.Assistant,
                parts: [{ type: 'text', text: assistantText }],
                degraded: degradedThisTurn,
                runId: capturedRunId,
              },
              Date.now(),
            );
          }
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
