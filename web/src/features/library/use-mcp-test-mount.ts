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

/** Raw wire union `postSseStream` validates each mcp-test-mount SSE frame
 *  against, before `useMcpTestMount.start()` unwraps the envelope (see
 *  `unwrapWireFrame`). */
export const McpTestMountWireFrameSchema = z.union([
  StatusEnvelopeSchema,
  McpServerPartSchema,
]);
type McpTestMountWireFrame = z.infer<typeof McpTestMountWireFrameSchema>;

/** Logical frame `foldMcpTestMountFrame` operates on: a flat `StatusEvent`
 *  (envelope already stripped) or the one-shot terminal data part. Unlike
 *  the builder-build flow, `test-mount.ts` never writes narration
 *  `text-delta` parts — `data-mcp-mount` progress rides the StatusEvent
 *  envelope instead, and the fold below turns it into a narration line. */
export type McpTestMountFrame =
  | StatusEvent
  | { type: 'data-mcp-server'; data: unknown };

/** Strips the `{ type, data, transient }` envelope off a wire frame — same
 *  `unwrapWireFrame` logic as `use-build-events.ts` (Task 13). */
function unwrapWireFrame(frame: McpTestMountWireFrame): McpTestMountFrame {
  if (frame.type === 'data-mcp-server') return frame;
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
    for await (const wireFrame of postSseStream(
      '/api/mcp/test-mount',
      { name },
      McpTestMountWireFrameSchema,
      signal,
    )) {
      const frame = unwrapWireFrame(wireFrame);
      setState((prev) => foldMcpTestMountFrame(prev, frame));
    }
  }, []);

  const respond = useCallback((value: boolean) => {
    setState((prev) => {
      if (!prev.pendingConfirm || !prev.runId) return prev;
      void createSseTransport().respond(prev.runId, {
        promptId: prev.pendingConfirm.promptId,
        value,
      });
      return { ...prev, pendingConfirm: undefined };
    });
  }, []);

  return { state, start, respond };
}
