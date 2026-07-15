import type { SpanDTO } from '@contracts';
import { useCallback, useState } from 'react';

export type RunTraceState = { spans: SpanDTO[]; cursor: string | null };

/** Merge one SpanDTO into the trace view: de-dupe by spanId, keep offset-sorted,
 *  advance the resume cursor. Pure — unit-tested like `foldEvent`. */
export function foldSpan(
  state: RunTraceState,
  span: SpanDTO,
  eventId?: string,
): RunTraceState {
  const next = state.spans.filter((s) => s.spanId !== span.spanId);
  next.push(span);
  next.sort((a, b) => a.offsetMs - b.offsetMs);
  return { spans: next, cursor: eventId ?? state.cursor };
}

/**
 * Merges an initial run-detail snapshot with live-streamed SpanDTOs into a
 * de-duped, offset-sorted trace view, mirroring `useStatusEvents`'s
 * `useState` + `useCallback` shape.
 */
export function useRunTrace(initial: SpanDTO[]) {
  const [state, setState] = useState<RunTraceState>(() =>
    initial.reduce<RunTraceState>((s, span) => foldSpan(s, span), {
      spans: [],
      cursor: null,
    }),
  );
  const ingest = useCallback((span: SpanDTO, eventId?: string) => {
    setState((prev) => foldSpan(prev, span, eventId));
  }, []);
  return { spans: state.spans, cursor: state.cursor, ingest };
}
