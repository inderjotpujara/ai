import type { StatusEvent } from '@contracts';
import { StatusEventSchema, StatusEventType } from '@contracts';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import {
  createSseTransport,
  postSseStream,
} from '../../shared/transport/sse-adapter.ts';

/** `text-start`/`text-delta`/`text-end` parts carrying build narration
 *  (`logToTextDelta`, `src/server/builders/adapter.ts`) — flat, no envelope,
 *  one fresh id per `log()` call. */
const TextPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-start'), id: z.string() }),
  z.object({
    type: z.literal('text-delta'),
    id: z.string(),
    delta: z.string(),
  }),
  z.object({ type: z.literal('text-end'), id: z.string() }),
]);
type TextPart = z.infer<typeof TextPartSchema>;

/** `data-run-start`/`data-confirm`/`data-run-end` ride the wire wrapped in an
 *  AI-SDK data-part envelope: `src/server/builders/build.ts`'s `events` sink
 *  writes `{ type: e.type, data: e, transient: true }`, where `e` is itself
 *  the flat `StatusEvent` (confirmed against `build.ts` + the consent
 *  registry — the build route only ever emits RunStart/Confirm/RunEnd this
 *  way; the other `StatusEventType`s belong to agent/crew EXECUTION runs,
 *  a different code path, but `StatusEventSchema` is reused as-is since it
 *  already covers the full union). `.data` is what `unwrapWireFrame` below
 *  strips off before folding. */
const StatusEnvelopeSchema = z.object({
  type: z.enum(StatusEventType),
  data: StatusEventSchema,
  transient: z.boolean().optional(),
});

/** The terminal `BuildResultDTO`, written EXACTLY ONCE as a one-shot data
 *  part (`build.ts`: `writer.write({ type: 'data-build-result', data: result })`).
 *  Deviation from the task-13 brief's original snippet, which modeled this
 *  as a `text-delta` (id `'build-result'`) carrying a JSON-stringified DTO —
 *  Task 11's adversarial verification established the real shape is a
 *  structured data part instead, so no JSON.parse/text-channel is involved.
 *  `data` is kept `unknown` here (this module stays pure/dependency-free of
 *  `BuildResultDtoSchema`) — Task 14 validates it before rendering. */
const BuildResultPartSchema = z.object({
  type: z.literal('data-build-result'),
  data: z.unknown(),
});
type BuildResultPart = z.infer<typeof BuildResultPartSchema>;

/** Raw wire union `postSseStream` validates each builder-build SSE frame
 *  against, before `useBuildEvents.start()` unwraps the StatusEvent
 *  envelope (see `unwrapWireFrame`). */
export const BuilderWireFrameSchema = z.union([
  StatusEnvelopeSchema,
  BuildResultPartSchema,
  TextPartSchema,
]);
type BuilderWireFrame = z.infer<typeof BuilderWireFrameSchema>;

/** Logical frame `foldBuildFrame` operates on: a flat `StatusEvent` (envelope
 *  already stripped), the one-shot build-result part, or a narration text
 *  part. Kept separate from `BuilderWireFrame` so the pure fold function
 *  (unit-tested exactly like `foldSpan`/`foldEvent` elsewhere) never has to
 *  know about the wire envelope. */
export type BuilderFrame = StatusEvent | BuildResultPart | TextPart;

/** Strips the `{ type, data, transient }` envelope off a StatusEvent wire
 *  frame — `.data` IS the flat `StatusEvent` (see `StatusEnvelopeSchema`
 *  above). The build-result part and text parts are not enveloped the same
 *  way and pass through unchanged. */
function unwrapWireFrame(frame: BuilderWireFrame): BuilderFrame {
  if (
    frame.type === 'data-build-result' ||
    frame.type === 'text-start' ||
    frame.type === 'text-delta' ||
    frame.type === 'text-end'
  ) {
    return frame;
  }
  return frame.data;
}

export type PendingConfirm = {
  promptId: string;
  kind: string;
  question: string;
};

export type BuildFoldState = {
  runId?: string;
  narration: string[];
  pendingConfirm?: PendingConfirm;
  /** Parsed from the `data-build-result` part once it arrives. Typed
   *  `unknown` here (the fold is pure/dependency-free); Task 14 validates it
   *  against `BuildResultDtoSchema` before rendering. */
  result?: unknown;
  done: boolean;
};

/** Pure fold: one `BuilderFrame` in, next state out — unit-tested exactly
 *  like `foldSpan`/`foldEvent` elsewhere in this codebase. */
export function foldBuildFrame(
  state: BuildFoldState,
  frame: BuilderFrame,
): BuildFoldState {
  switch (frame.type) {
    case StatusEventType.RunStart:
      return { ...state, runId: frame.runId };
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
    case 'data-build-result':
      return { ...state, result: frame.data };
    case 'text-delta':
      return { ...state, narration: [...state.narration, frame.delta] };
    default:
      return state;
  }
}

const INITIAL_STATE: BuildFoldState = { narration: [], done: false };

/** Opens the builder-build SSE connection itself (no `useChat` — unlike
 *  chat's `useStatusEvents`, spec §4.4), folds every frame through
 *  `foldBuildFrame`, and answers a pending confirm via the EXISTING
 *  `createSseTransport().respond()` (the same Phase-2 respond path
 *  `ChatArea` already uses). */
export function useBuildEvents() {
  const [state, setState] = useState<BuildFoldState>(INITIAL_STATE);

  const start = useCallback(
    async (
      body: { kind: string; need: string; autoYes?: boolean; force?: boolean },
      signal?: AbortSignal,
    ) => {
      setState(INITIAL_STATE);
      for await (const wireFrame of postSseStream(
        '/api/builders/build',
        body,
        BuilderWireFrameSchema,
        signal,
      )) {
        const frame = unwrapWireFrame(wireFrame);
        setState((prev) => foldBuildFrame(prev, frame));
      }
    },
    [],
  );

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

  return { ...state, start, respond };
}
