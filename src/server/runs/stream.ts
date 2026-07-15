import { RunLifecycle, type SpanDTO } from '../../contracts/index.ts';
import { mapRunToDto } from '../../run/run-dto.ts';
import { withRunStreamSpan } from '../../telemetry/spans.ts';
import { ISOLATION_HEADERS } from '../isolation-headers.ts';
import { confineToDir, MediaPathError } from '../security/media-path.ts';
import type { RunsDeps } from './detail.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function frame(span: SpanDTO): string {
  return `id: ${span.spanId}\ndata: ${JSON.stringify(span)}\n\n`;
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
 * nothing. Bounded by `maxWaitMs` and `signal`. Any read error mid-tail
 * degrades to a clean close (never throws out of the stream). Wrapped in
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

  const pollMs = opts.pollMs ?? 250;
  const maxWaitMs = opts.maxWaitMs ?? 600_000;
  const encoder = new TextEncoder();

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
              if (opts.signal?.aborted || Date.now() > deadline) {
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
                  const cursorPresent = dto.spans.some(
                    (s) => s.spanId === opts.lastEventId,
                  );
                  if (cursorPresent) {
                    for (const s of dto.spans) {
                      emitted.add(s.spanId);
                      if (s.spanId === opts.lastEventId) break;
                    }
                  }
                }
                for (const s of dto.spans) {
                  if (emitted.has(s.spanId)) continue;
                  emitted.add(s.spanId);
                  const text = frame(s);
                  controller.enqueue(encoder.encode(text));
                  rec.chunk(text.length);
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
            controller.close();
          }
        },
      );
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
