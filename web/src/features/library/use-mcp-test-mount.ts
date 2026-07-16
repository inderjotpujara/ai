import type { McpServerDTO, StatusEvent } from '@contracts';
import { StatusEventSchema, StatusEventType } from '@contracts';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import {
  createSseTransport,
  postSseStream,
} from '../../shared/transport/sse-adapter.ts';

/**
 * `data-run-start`/`data-mcp-mount`/`data-confirm`/`data-run-end` ride the
 * wire wrapped in an AI-SDK data-part envelope — `src/server/mcp/test-mount.ts`'s
 * `events` sink writes `{ type: e.type, data: e, transient: true }`, exactly
 * the same shape the T11 builder-build route's `events` sink emits
 * (`use-build-events.ts`'s `StatusEnvelopeSchema`). `.data` IS the flat
 * `StatusEvent`. Reused as-is (not redefined) since it already covers the
 * full union, same precedent as T13.
 */
const StatusEnvelopeSchema = z.object({
  type: z.enum(StatusEventType),
  data: StatusEventSchema,
  transient: z.boolean().optional(),
});

/**
 * The terminal `McpServerDTO`, written EXACTLY ONCE as a one-shot data part
 * the SAME way the builder route writes `data-build-result`
 * (`writer.write({ type: 'data-mcp-server', data: ..., transient: true })`,
 * `src/server/mcp/test-mount.ts`). `data` stays `unknown` here so this
 * module doesn't depend on `McpServerDtoSchema` — `mcp-tab.tsx` is the
 * boundary that treats it as an `McpServerDTO`.
 */
const McpServerPartSchema = z.object({
  type: z.literal('data-mcp-server'),
  data: z.unknown(),
  transient: z.boolean().optional(),
});

/**
 * AI-SDK UI-message-stream error part — same shape/precedent as
 * `use-build-events.ts`'s `ErrorFrameSchema` (`{ type: 'error', errorText }`),
 * emitted when `createUIMessageStream`'s `execute` rejects (`onError` in
 * `src/server/mcp/test-mount.ts`: e.g. `withRunTelemetry`/`createRun`
 * failing before the route's own try/catch around `mountOne` even starts).
 * Without this member `postSseStream`'s `schema.parse` throws on the frame
 * and the fold loop dies silently (finding #2).
 */
const ErrorFrameSchema = z.object({
  type: z.literal('error'),
  errorText: z.string(),
});
type ErrorFrame = z.infer<typeof ErrorFrameSchema>;

/** Raw wire union `postSseStream` validates each mcp-test-mount SSE frame
 *  against, before `useMcpTestMount.start()` unwraps the envelope (see
 *  `unwrapWireFrame`). */
export const McpTestMountWireFrameSchema = z.union([
  StatusEnvelopeSchema,
  McpServerPartSchema,
  ErrorFrameSchema,
]);
type McpTestMountWireFrame = z.infer<typeof McpTestMountWireFrameSchema>;

/** Logical frame `foldMcpTestMountFrame` operates on: a flat `StatusEvent`
 *  (envelope already stripped), the one-shot terminal data part, or the
 *  error part. Unlike the builder-build flow, `test-mount.ts` never writes
 *  narration `text-delta` parts — `data-mcp-mount` progress rides the
 *  StatusEvent envelope instead, and the fold below turns it into a
 *  narration line. */
export type McpTestMountFrame =
  | StatusEvent
  | { type: 'data-mcp-server'; data: unknown }
  | ErrorFrame;

/** Strips the `{ type, data, transient }` envelope off a wire frame — same
 *  `unwrapWireFrame` logic as `use-build-events.ts` (Task 13). */
function unwrapWireFrame(frame: McpTestMountWireFrame): McpTestMountFrame {
  if (frame.type === 'data-mcp-server' || frame.type === 'error') return frame;
  return frame.data;
}

export type PendingConfirm = {
  promptId: string;
  kind: string;
  question: string;
};

export type McpTestMountState = {
  runId?: string;
  narration: string[];
  pendingConfirm?: PendingConfirm;
  result?: McpServerDTO;
  done: boolean;
  /** Set from a wire `error` frame OR a thrown/rejected `start()` call (see
   *  `start()`'s catch below) — mirrors `BuildFoldState.error`. */
  error?: string;
};

const INITIAL_STATE: McpTestMountState = { narration: [], done: false };

/**
 * Pure fold: one `McpTestMountFrame` in, next state out — unit-tested
 * exactly like `foldBuildFrame` (Task 13) / `foldSpan`/`foldEvent` elsewhere.
 */
export function foldMcpTestMountFrame(
  state: McpTestMountState,
  frame: McpTestMountFrame,
): McpTestMountState {
  switch (frame.type) {
    case StatusEventType.RunStart:
      return { ...state, runId: frame.runId };
    case StatusEventType.McpMount:
      return {
        ...state,
        narration: [...state.narration, `${frame.server}: ${frame.outcome}`],
      };
    case StatusEventType.Confirm:
      return {
        ...state,
        pendingConfirm: {
          promptId: frame.promptId,
          kind: frame.kind,
          question: frame.question,
        },
      };
    case StatusEventType.RunEnd:
      return { ...state, done: true };
    case 'data-mcp-server':
      return {
        ...state,
        result: frame.data as McpServerDTO,
        pendingConfirm: undefined,
      };
    case 'error':
      // Finding #2: surface the stream-failure error frame instead of
      // silently dying inside the fold loop.
      return {
        ...state,
        error: frame.errorText,
        done: true,
        pendingConfirm: undefined,
      };
    default:
      return state;
  }
}

/**
 * Opens the `POST /api/mcp/test-mount` SSE connection itself (no `useChat`,
 * same as `useBuildEvents` — spec §4.4), folds every frame through
 * `foldMcpTestMountFrame`, and answers a pending confirm via the EXISTING
 * `createSseTransport().respond()` (the same Phase-2 respond path chat/
 * builders already use). Reuses `postSseStream` (Task 13) rather than a
 * bespoke `fetch().getReader()` loop — one POST-SSE reader, one wire
 * contract, shared by both interactive flows.
 */
export function useMcpTestMount() {
  const [state, setState] = useState<McpTestMountState>(INITIAL_STATE);

  const start = useCallback(async (name: string, signal?: AbortSignal) => {
    setState(INITIAL_STATE);
    try {
      for await (const wireFrame of postSseStream(
        '/api/mcp/test-mount',
        { name },
        McpTestMountWireFrameSchema,
        signal,
      )) {
        const frame = unwrapWireFrame(wireFrame);
        setState((prev) => foldMcpTestMountFrame(prev, frame));
      }
    } catch (err) {
      // A thrown/rejected stream (network drop, non-2xx response, schema
      // mismatch) must surface the same way a wire `error` frame does —
      // never leave the caller with an unhandled rejection and a frozen tab
      // (finding #2).
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
        done: true,
      }));
    }
  }, []);

  const respond = useCallback(
    (value: boolean) => {
      // Minor #5: read the pending confirm from the CURRENT render's closure
      // and fire the POST once, OUTSIDE the setState updater — see
      // `use-build-events.ts`'s `respond()` for the full StrictMode
      // double-invoke rationale.
      const pending = state.pendingConfirm;
      const runId = state.runId;
      if (!pending || !runId) return;
      setState((prev) => ({ ...prev, pendingConfirm: undefined }));
      void createSseTransport().respond(runId, {
        promptId: pending.promptId,
        value,
      });
    },
    [state.pendingConfirm, state.runId],
  );

  return { state, start, respond };
}
