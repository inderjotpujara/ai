import { RunLifecycle, type SpanDTO } from '../../contracts/index.ts';
import { mapRunToDto } from '../../run/run-dto.ts';
import { withRunStreamSpan } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';
import type { RunsDeps } from './detail.ts';
import { acquireStreamSlot, releaseStreamSlot } from './stream-limit.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// C0 control chars (includes CR \r and LF \n), written as \u escapes so no
// literal control char appears in the source.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control chars to strip them from an untrusted id
const CONTROL_CHARS = /[\u0000-\u001f]/g;

/**
 * Build one SSE frame. The `id:` line interpolates `span.spanId` raw, so any
 * control char (notably CR/LF) in it could inject a spurious frame/field —
 * strip them (defense-in-depth for future remote run-sync, where spanIds may
 * not be locally generated). The `data:` line is JSON, which already escapes
 * newlines, so only the `id:` line needs sanitizing.
 */
function frame(span: SpanDTO): string {
  const safeId = span.spanId.replace(CONTROL_CHARS, '');
  return `id: ${safeId}\ndata: ${JSON.stringify(span)}\n\n`;
}

export type RunStreamOpts = {
  lastEventId?: string;
  signal?: AbortSignal;
  pollMs?: number;
  maxWaitMs?: number;
};

/**
 * `GET /api/runs/:id/stream` — live-tailing SSE. `confineToDir` guards the id
 * against `../`/symlink/absolute traversal (→ 404, indistinguishable from a
 * missing run). Otherwise a `text/event-stream` whose body: (a) emits each
 * `RunDTO.spans` entry as an SSE frame `id: <spanId>\ndata: <json>\n\n`,
 * tracking emitted spanIds; (b) re-polls `mapRunToDto` every `pollMs` emitting
 * only new spans until `lifecycle !== Running` (root closed — the same stop
 * signal the CLI `--follow` uses), then records the outcome + closes; (c) on
 * `Last-Event-ID`, seeds the emitted set with every span up to and including
 * that id so only newer spans replay. A stale/unknown cursor degrades to a
 * fresh connection (full snapshot replay) rather than silently emitting
 * nothing. Bounded by `maxWaitMs`, the caller `signal`, and a reader
 * disconnect (`ReadableStream.cancel()` aborts an internal controller so the
 * poll loop stops promptly rather than reading disk to `maxWaitMs`). Any read
 * error mid-tail degrades to a clean close, and the `finally` close is guarded
 * so a cancelled controller never rejects the wrapping span. Wrapped in
 * `withRunStreamSpan`.
 */
export async function handleRunStream(
  id: string,
  deps: RunsDeps,
  opts: RunStreamOpts,
): Promise<Response> {
  try {
    confineToDir(id, deps.runsRoot);
  } catch (err) {
    if (err instanceof MediaPathError) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          ...ISOLATION_HEADERS,
        },
      });
    }
    throw err;
  }

  if (!acquireStreamSlot()) {
    return new Response(JSON.stringify({ error: 'too many streams' }), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...ISOLATION_HEADERS,
      },
    });
  }

  const pollMs = opts.pollMs ?? 250;
  const maxWaitMs = opts.maxWaitMs ?? 600_000;
  const encoder = new TextEncoder();

  // A client disconnect surfaces as ReadableStream.cancel(); we abort this
  // internal controller so the poll loop stops on its next tick instead of
  // reading disk for an abandoned run until maxWaitMs. The loop stops on
  // EITHER the caller's signal or this one.
  const internal = new AbortController();

  // Released exactly once: the loop's normal/aborted exit (finally, below)
  // and a reader-initiated cancel() both want to free the slot, but they can
  // race (cancel() aborts the same signal the loop is already exiting on) —
  // guard so a double-fire never under-counts openStreamCount() and lets
  // more streams than the cap through.
  let slotReleased = false;
  function releaseSlotOnce(): void {
    if (slotReleased) return;
    slotReleased = true;
    releaseStreamSlot();
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void withRunStreamSpan(
        { route: `/api/runs/${id}/stream`, runId: id },
        async (rec) => {
          const emitted = new Set<string>();
          let seededResume = false;
          const deadline = Date.now() + maxWaitMs;
          try {
            for (;;) {
              if (
                opts.signal?.aborted ||
                internal.signal.aborted ||
                Date.now() > deadline
              ) {
                rec.outcome('aborted');
                break;
              }
              const dto = await mapRunToDto(deps.runsRoot, id);
              if (dto) {
                // Resume: on the first real snapshot, mark everything up to and
                // including lastEventId as already-emitted so only newer spans
                // replay. A stale/unknown cursor (not present in the snapshot)
                // degrades to a fresh connection — replay the full snapshot
                // rather than silently emitting nothing.
                if (!seededResume && opts.lastEventId) {
                  seededResume = true;
                  rec.resume();
                  // Seed by WIRE order, not DTO-index order. Spans flush to the
                  // journal when they END, so a client received them in
                  // end-time order — and a nested run's root (`agent.run`)
                  // ends LAST yet sorts FIRST in the depth-first DTO (it is
                  // depth-0). Reseeding by DTO index would mark that
                  // late-written root as already-seen whenever the cursor is an
                  // earlier-ending child, silently DROPPING the terminal frame
                  // on reconnect (§7.1 gap). End time isn't on the DTO, but
                  // `offsetMs + durationMs` (start-from-root + duration) is a
                  // monotonic proxy for it; ties (same end) break on DTO order,
                  // which is the within-poll wire order. Mark every span that
                  // ended at or before the cursor; everything newer replays. A
                  // stale/unknown cursor (not present) degrades to a fresh
                  // connection — replay the full snapshot rather than emit
                  // nothing.
                  const cursor = dto.spans.find(
                    (s) => s.spanId === opts.lastEventId,
                  );
                  if (cursor) {
                    const cursorIdx = dto.spans.indexOf(cursor);
                    const cursorEnd = cursor.offsetMs + cursor.durationMs;
                    dto.spans.forEach((s, i) => {
                      const end = s.offsetMs + s.durationMs;
                      if (
                        end < cursorEnd ||
                        (end === cursorEnd && i <= cursorIdx)
                      ) {
                        emitted.add(s.spanId);
                      }
                    });
                  }
                }
                for (const s of dto.spans) {
                  if (emitted.has(s.spanId)) continue;
                  // The reader may have cancelled mid-snapshot; stop enqueuing
                  // onto a controller whose stream is gone.
                  if (internal.signal.aborted) break;
                  emitted.add(s.spanId);
                  const bytes = encoder.encode(frame(s));
                  controller.enqueue(bytes);
                  // Count UTF-8 bytes, not UTF-16 code units, so the telemetry
                  // reflects what actually went over the wire.
                  rec.chunk(bytes.byteLength);
                }
                if (dto.lifecycle !== RunLifecycle.Running) {
                  rec.outcome(dto.outcome);
                  break;
                }
              }
              await sleep(pollMs);
            }
          } catch {
            // Degrade: end the stream with the last known spans, never crash
            // the reader. The outcome tag makes the truncation observable.
            rec.outcome('error');
          } finally {
            // close() throws if the stream was already cancelled/errored by the
            // reader; swallow so the void-ed span promise never rejects.
            try {
              controller.close();
            } catch {
              // already closed/cancelled — nothing to do
            }
            releaseSlotOnce();
          }
        },
      );
    },
    cancel() {
      internal.abort();
      releaseSlotOnce();
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      ...ISOLATION_HEADERS,
    },
  });
}
