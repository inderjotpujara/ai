import type { RespondRequest, StatusEvent } from '@contracts';
import type { ZodType } from 'zod';

/** A transport event = a wire StatusEvent tagged with an SSE event id for resume. */
export type TransportEvent = StatusEvent & { eventId: string };

/**
 * Bidirectional + resumable transport (spec D14). Interface only for now —
 * the SSE adapter (Last-Event-ID reconnect) lands in Phase 2; this leaves
 * room for WS/resumable later.
 */
export type ChatTransport = {
  /**
   * server→client stream; `fromCursor` replays after a Last-Event-ID reconnect.
   * `schema` parameterizes the frame payload (default `StatusEvent` for the
   * chat path; e.g. `SpanDtoSchema` for the runs live-tail). `signal` aborts
   * the underlying fetch so a consumer navigating away tears the connection
   * down immediately, even while idle between frames.
   */
  stream<T = StatusEvent>(
    runId?: string,
    fromCursor?: string | null,
    schema?: ZodType<T>,
    signal?: AbortSignal,
  ): AsyncIterable<T & { eventId: string }>;
  /** client→server back-channel: POST /api/runs/:id/respond (consent / human-in-loop). */
  respond(runId: string, payload: RespondRequest): Promise<void>;
};

/** A live run handle carrying the resume cursor (last seen event id). */
export type RunStream = {
  runId: string;
  cursor: string | null;
};
