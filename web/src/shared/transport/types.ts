import type { RespondRequest, StatusEvent } from '@contracts';

/** A transport event = a wire StatusEvent tagged with an SSE event id for resume. */
export type TransportEvent = StatusEvent & { eventId: string };

/**
 * Bidirectional + resumable transport (spec D14). Adapter is SSE now
 * (Last-Event-ID reconnect); the interface leaves room for WS/resumable later.
 */
export type ChatTransport = {
  /** server→client stream; `fromCursor` replays after a Last-Event-ID reconnect. */
  stream(
    runId?: string,
    fromCursor?: string | null,
  ): AsyncIterable<TransportEvent>;
  /** client→server back-channel: POST /api/runs/:id/respond (consent / human-in-loop). */
  respond(runId: string, payload: RespondRequest): Promise<void>;
};

/** A live run handle carrying the resume cursor (last seen event id). */
export type RunStream = {
  runId: string;
  cursor: string | null;
};
