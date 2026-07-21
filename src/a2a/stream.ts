/**
 * A2A streaming re-framing (Slice 31, Task 12 — §7.1-adjacent reconnect gap).
 *
 * PURE, I/O-free framer that maps ONE run `SpanDTO` (as produced by the single
 * run-stream engine, `server/runs/stream.ts`) onto ONE A2A SSE frame — a
 * `TaskStatusUpdateEvent` or a `TaskArtifactUpdateEvent` — or `undefined` for a
 * span with no A2A meaning. There is exactly ONE underlying stream: the route
 * (`server/a2a/stream-route.ts`) delegates to `handleRunStream` and pipes each
 * frame through this framer; it never builds a parallel stream.
 *
 * KEYING invariant: a span-derived frame carries `id: <span.spanId>`, the SAME
 * wire id the run-stream keys by, so `Last-Event-ID` reconnect replay lands the
 * client on the right span with NO gap and NO duplicate (the run-stream's
 * end-time seeding does the work; this framer must not change the id).
 *
 * TERMINAL invariant: the run ROOT span maps to a `final: true` completed/failed
 * status-update — never to `undefined` — so the terminal frame is never dropped.
 * The precursor roots (`mcp.mount` / `memory.*`) that flush at run START are
 * DELIBERATELY excluded from the terminal set (`A2A_TERMINAL_ROOTS`); framing one
 * as `completed` would close the task before the real run root ends — the exact
 * premature-terminal shape the Slice-24 run-stream fix guards against.
 */

import { type SpanDTO, SpanStatus, TaskStateWire } from '../contracts/index.ts';

export type A2aStreamCtx = { taskId: string; contextId: string };

/**
 * Top-level run roots whose END is the run's OWN terminal signal for an
 * A2A-exposed task (Chat/Crew/Workflow/Agent). Excludes the ephemeral precursor
 * roots (`mcp.mount`, `memory.recall`, `memory.ingest`) that a run flushes at
 * START — mirroring `run-trace.ts`'s `TERMINAL_RUN_ROOTS` rationale — so an
 * early precursor never emits a premature `completed`.
 */
const A2A_TERMINAL_ROOTS: ReadonlySet<string> = new Set([
  'chat.run',
  'agent.run',
  'crew.run',
  'workflow.run',
]);

/** Whether a span name is a terminal run root for an A2A task (see above). */
export function isA2aTerminalRoot(name: string): boolean {
  return A2A_TERMINAL_ROOTS.has(name);
}

// C0 control chars (incl. CR/LF), as \u escapes so no literal control char is
// in the source. The `id:` line interpolates a spanId that — for a future
// remote run-sync — may not be locally generated, so strip control chars to
// stop a CR/LF from injecting a spurious frame. The `data:` line is JSON, which
// already escapes newlines. (Same defense as `server/runs/stream.ts`.)
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control chars to strip them from an untrusted id
const CONTROL_CHARS = /[\u0000-\u001f]/g;

/** Build one SSE frame. A frame WITHOUT an id (synthetic submitted/working, or
 *  the result-derived answer artifact) intentionally omits the `id:` line so it
 *  never becomes the client's `Last-Event-ID` cursor — only real span frames do,
 *  keeping reconnect replay keyed on the run-stream's own wire ids. */
export function a2aSseFrame(payload: unknown, id?: string): string {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  if (id === undefined) return data;
  return `id: ${id.replace(CONTROL_CHARS, '')}\n${data}`;
}

/** A `TaskStatusUpdateEvent` SSE frame. */
export function a2aStatusFrame(
  ctx: A2aStreamCtx,
  state: TaskStateWire,
  final: boolean,
  id?: string,
): string {
  return a2aSseFrame(
    {
      taskId: ctx.taskId,
      contextId: ctx.contextId,
      kind: 'status-update',
      status: { state },
      final,
    },
    id,
  );
}

/** A `TaskArtifactUpdateEvent` SSE frame. `id` is omitted for the result-derived
 *  answer artifact (so it never poisons the resume cursor). */
export function a2aArtifactFrame(
  ctx: A2aStreamCtx,
  artifact: unknown,
  opts: { append: boolean; lastChunk: boolean },
  id?: string,
): string {
  return a2aSseFrame(
    {
      taskId: ctx.taskId,
      contextId: ctx.contextId,
      kind: 'artifact-update',
      artifact,
      append: opts.append,
      lastChunk: opts.lastChunk,
    },
    id,
  );
}

/**
 * Map ONE run `SpanDTO` → ONE A2A SSE frame, or `undefined` to skip it.
 *
 * - A terminal run root → `completed` (ok) / `failed` (error) status-update,
 *   `final: true`, keyed by `spanId` (the terminal frame — never undefined).
 * - A delegation span → a progress `artifact-update` with a `data` part (the
 *   sub-agent step), keyed by `spanId`.
 * - Anything else → `undefined` (no A2A meaning; skipped).
 */
export function frameRunSpanAsA2a(
  span: SpanDTO,
  ctx: A2aStreamCtx,
): string | undefined {
  if (isA2aTerminalRoot(span.name)) {
    const state =
      span.status === SpanStatus.Error
        ? TaskStateWire.Failed
        : TaskStateWire.Completed;
    return a2aStatusFrame(ctx, state, true, span.spanId);
  }
  if (span.delegation) {
    return a2aArtifactFrame(
      ctx,
      {
        artifactId: `${ctx.taskId}-progress-${span.spanId}`,
        name: 'progress',
        parts: [
          {
            kind: 'data',
            data: {
              step: span.name,
              agent: span.delegation.target,
              status: span.status,
            },
          },
        ],
      },
      { append: true, lastChunk: false },
      span.spanId,
    );
  }
  return undefined;
}
