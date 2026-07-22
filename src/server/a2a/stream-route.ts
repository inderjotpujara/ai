/**
 * A2A streaming route (Slice 31, Task 12) — `message/stream` + `tasks/resubscribe`.
 *
 * ONE SSE engine, TWO framings. This route NEVER builds a second stream: it
 * delegates to the single run-stream engine (`handleRunStream`, which owns the
 * poll loop, the stream-limit slot, the `Last-Event-ID` end-time seeding, and
 * the Slice-24 terminal-frame-on-reconnect fix) and pipes each `SpanDTO` frame
 * it emits through the pure `frameRunSpanAsA2a` re-framer. The run-stream's
 * correctness — terminal frame never dropped, replay with no gap/dup — is
 * therefore inherited, not re-implemented.
 *
 * - `message/stream`: reuse `handleMessageSend` to resolve-then-reject (§7.4)
 *   and enqueue (§7.2), then open the re-framed SSE. Opens with a synthetic
 *   `submitted` → `working` pair (no `id:` line, so they never become a resume
 *   cursor), then re-frames the run. When the run root's terminal frame arrives,
 *   the real answer text artifact (`orchestratorResultToArtifact` on the job
 *   result, stable id `${taskId}-artifact-0` to match `tasks/get`) is emitted
 *   BEFORE the `completed` status-update — the A2A `artifact → completed` order.
 * - `tasks/resubscribe`: resolve the task's runId and re-attach `handleRunStream`
 *   with the HTTP `Last-Event-ID`. NO synthetic submitted/working (a reconnect,
 *   not a fresh subscription) — the run-stream seeds past the cursor so only
 *   newer frames replay, and the answer artifact is re-derived if the root
 *   replays (so the terminal answer+completed pair survives a mid-stream drop).
 *
 * REPLAY-GAP invariant: only real span frames carry an `id:` line (the span's
 * wire id). Synthetic opening frames and the result-derived answer artifact are
 * id-less, so a drop between the answer artifact and `completed` leaves the
 * client's cursor on the last CHILD span → the run-stream replays the root →
 * this route re-emits answer+completed. The terminal pair is never orphaned.
 */

import { type A2aServerDeps, handleMessageSend } from '../../a2a/server.ts';
import {
  type A2aStreamCtx,
  a2aArtifactFrame,
  a2aStatusFrame,
  frameRunSpanAsA2a,
  isA2aTerminalRoot,
} from '../../a2a/stream.ts';
import {
  consentDeclinedToTaskError,
  orchestratorResultToArtifact,
} from '../../a2a/task-map.ts';
import {
  A2aMethod,
  JsonRpcResponseSchema,
  type SpanDTO,
  SpanDtoSchema,
  TaskStateWire,
} from '../../contracts/index.ts';
import type { OrchestratorResult } from '../../core/orchestrator.ts';
import { JobStatus } from '../../queue/types.ts';
import { handleRunStream } from '../runs/stream.ts';

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-store',
};
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** A JSON-RPC id per the spec: a string, a number, or null (echoed verbatim so a
 *  batching client can correlate the reply). */
type JsonRpcId = string | number | null;

/** A non-SSE pre-stream rejection (a resolve-then-reject rejection or an
 *  unresolvable resubscribe) — no stream opens, so there is nothing to frame.
 *  Returned as a proper JSON-RPC 2.0 envelope (`{jsonrpc,id,error}`) echoing the
 *  request `id`, matching the non-streaming `rpc.ts` path — not a bare
 *  `{error}`. Rides HTTP 200 (the error lives in the body, not the transport). */
function jsonRpcError(id: JsonRpcId, code: number, message: string): Response {
  const envelope = { jsonrpc: '2.0', id, error: { code, message } };
  return new Response(JSON.stringify(JsonRpcResponseSchema.parse(envelope)), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Parse a re-assembled upstream SSE `data:` payload into a `SpanDTO`, returning
 * `undefined` (SKIP this line) when it is not JSON or not a valid span. The
 * `JSON.parse` is wrapped in try/skip so ONE malformed upstream line (a
 * truncated frame, a future non-span line) skips only that line rather than
 * throwing out of the reader loop — an uncaught throw there degrades the whole
 * A2A stream to a clean close and DROPS the buffered terminal (`final:true`)
 * frame. Mirrors the adjacent `SpanDtoSchema.safeParse` skip-don't-throw.
 */
export function parseSpanFrame(dataPayload: string): SpanDTO | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(dataPayload);
  } catch {
    return undefined;
  }
  const parsed = SpanDtoSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

const RESULT_KINDS = new Set(['answer', 'gap', 'resource']);
function isOrchestratorResult(value: unknown): value is OrchestratorResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    RESULT_KINDS.has((value as { kind?: unknown }).kind as string)
  );
}

/** The terminal ANSWER artifact for a Done job, with a stable id matching
 *  `tasks/get`'s `projectArtifacts` (`${taskId}-artifact-0`) so identity never
 *  churns across get/stream. `undefined` unless the job is Done with an
 *  `answer` result (a gap/resource failure's detail rides the failed status,
 *  never an artifact). */
function answerArtifact(
  deps: A2aServerDeps,
  taskId: string,
): Record<string, unknown> | undefined {
  const job = deps.jobStore.getJob(taskId);
  if (job === undefined || job.status !== JobStatus.Done) return undefined;
  if (!isOrchestratorResult(job.result)) return undefined;
  const base = orchestratorResultToArtifact(job.result);
  if (base === undefined) return undefined;
  return { ...base, artifactId: `${taskId}-artifact-0` };
}

/** Split a run-stream SSE byte stream into `SpanDTO`s, re-frame each through the
 *  A2A framer, and enqueue the resulting A2A frames — injecting the answer
 *  artifact just before a terminal root's `completed`/`failed` frame. Reader
 *  cancellation stops the upstream loop (its slot is freed) via `signal`. */
function reframedBody(
  runId: string,
  ctx: A2aStreamCtx,
  deps: A2aServerDeps,
  lastEventId: string | undefined,
  openWithLifecycle: boolean,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let reader:
    | ReturnType<NonNullable<Response['body']>['getReader']>
    | undefined;

  function emit(
    controller: ReadableStreamDefaultController<Uint8Array>,
    frame: string,
  ): void {
    controller.enqueue(encoder.encode(frame));
  }

  // Buffer for the terminal root's frames (answer artifact + the final:true
  // completed/failed status-update). It is NOT emitted inline: the run DTO is
  // depth-first, so the run root sorts BEFORE its children within a single poll
  // — emitting `completed(final:true)` there would put it ahead of a same-poll
  // child's progress artifact, and a spec-conformant client closes on
  // `final:true` and loses the trailing frame (or re-replays the root on
  // reconnect → duplicate terminal). We hold it and flush ONLY once the
  // upstream reader reaches EOF (all same-poll children already emitted), so
  // `final:true` is genuinely the last frame. The answer artifact stays
  // immediately before `completed` (both buffered back-to-back) and is id-less.
  const terminal: string[] = [];

  function reframe(
    controller: ReadableStreamDefaultController<Uint8Array>,
    span: SpanDTO,
  ): void {
    // Fail-closed consent (Task 13, §7.1): if the backing job settled `Failed`
    // because dispatch declined a mid-run consent gate, the terminal `failed`
    // frame carries the typed `consent-unavailable` error (ignored on a
    // non-error root). The no-hang guarantee itself is the run-stream's terminal
    // root arriving as `failed` — this only refines that frame's detail.
    const terminalError = consentDeclinedToTaskError(
      deps.jobStore.getJob(ctx.taskId) ?? { status: JobStatus.Queued },
    )?.error;
    const framed = frameRunSpanAsA2a(span, ctx, terminalError);
    if (framed === undefined) return;
    if (isA2aTerminalRoot(span.name)) {
      // Buffer (don't emit) — flushed at EOF. Keep only the latest terminal.
      terminal.length = 0;
      const artifact = answerArtifact(deps, ctx.taskId);
      if (artifact !== undefined) {
        terminal.push(
          a2aArtifactFrame(ctx, artifact, { append: false, lastChunk: true }),
        );
      }
      terminal.push(framed);
      return;
    }
    emit(controller, framed);
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (openWithLifecycle) {
          // A fresh subscription opens with the lifecycle transition it already
          // knows (the job is submitted, and work is starting). Id-less so a
          // drop here leaves the cursor empty → full replay, never a gap.
          emit(controller, a2aStatusFrame(ctx, TaskStateWire.Submitted, false));
          emit(controller, a2aStatusFrame(ctx, TaskStateWire.Working, false));
        }
        const upstream = await handleRunStream(
          runId,
          { runsRoot: deps.runsRoot },
          { lastEventId, signal: abort.signal },
        );
        const body = upstream.body;
        if (body === null) return;
        const rd = body.getReader();
        reader = rd;
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep = buf.indexOf('\n\n');
          while (sep !== -1) {
            const raw = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const data: string[] = [];
            for (const line of raw.split('\n')) {
              if (line.startsWith('data:')) data.push(line.slice(5).trim());
            }
            if (data.length > 0) {
              // try/skip parse: a single non-JSON upstream line skips THIS frame
              // only — it must never throw out of the loop (that would close the
              // stream and drop the buffered terminal frame).
              const span = parseSpanFrame(data.join('\n'));
              if (span !== undefined) reframe(controller, span);
            }
            sep = buf.indexOf('\n\n');
          }
        }
        // Upstream EOF: every same-poll child/progress artifact has now been
        // emitted, so flush the buffered terminal frame(s) LAST — `final:true`
        // is genuinely the final frame on the wire.
        for (const f of terminal) emit(controller, f);
      } catch {
        // Degrade to a clean close — never crash the reader (mirrors the
        // run-stream engine's own read-error posture).
      } finally {
        try {
          controller.close();
        } catch {
          // already closed/cancelled by the reader
        }
      }
    },
    cancel() {
      // Reader disconnect: abort the upstream run-stream so its poll loop stops
      // and frees its slot, then cancel our upstream reader.
      abort.abort();
      void reader?.cancel();
    },
  });
}

/**
 * Handle a streaming A2A method (`message/stream` / `tasks/resubscribe`),
 * returning a `text/event-stream` Response. On a resolve-then-reject rejection
 * or an unresolvable task, returns a non-SSE JSON-RPC error envelope instead
 * (no stream to frame) echoing the request `id`. The caller (`rpc.ts`) routes
 * here AFTER the enable-gate and passes the envelope's `id`.
 */
export async function handleA2aStream(
  params: unknown,
  method: A2aMethod,
  req: Request,
  deps: A2aServerDeps,
  id: JsonRpcId = null,
): Promise<Response> {
  if (method === A2aMethod.MessageStream) {
    // Reuse the non-streaming send: §7.4 resolve-then-reject + §7.2 fence +
    // enqueue. A rejection (unlisted skill) never opens a stream.
    const res = await handleMessageSend(params, deps);
    if (!res.ok) return jsonRpcError(id, res.error.code, res.error.message);
    const task = res.result as { id: string; contextId: string };
    const job = deps.jobStore.getJob(task.id);
    if (job?.runId === undefined) {
      return jsonRpcError(id, -32603, 'run not available for streaming');
    }
    const ctx: A2aStreamCtx = { taskId: task.id, contextId: task.contextId };
    return new Response(reframedBody(job.runId, ctx, deps, undefined, true), {
      headers: SSE_HEADERS,
    });
  }

  // tasks/resubscribe: resolve the running task's runId and re-attach with the
  // HTTP Last-Event-ID (EventSource's reconnect cursor). No synthetic opening
  // frames — this is a reconnect, not a fresh subscription.
  const taskId = asObject(params).id;
  if (typeof taskId !== 'string') {
    return jsonRpcError(id, -32602, 'invalid params');
  }
  const jobId = deps.taskIndex.jobIdForTask(taskId);
  const job = jobId === undefined ? undefined : deps.jobStore.getJob(jobId);
  if (job?.runId === undefined) {
    return jsonRpcError(id, -32001, 'task not found');
  }
  const ctx: A2aStreamCtx = {
    taskId,
    contextId: deps.taskIndex.contextFor(taskId),
  };
  const lastEventId = req.headers.get('Last-Event-ID') ?? undefined;
  return new Response(reframedBody(job.runId, ctx, deps, lastEventId, false), {
    headers: SSE_HEADERS,
  });
}
