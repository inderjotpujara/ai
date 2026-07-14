import type { StatusEvent } from '../contracts/index.ts';

/** A typed sink for run-status events. Threaded through the delegation chain
 *  exactly like `ledger?`. Default = no-op (CLI supplies a console sink; the
 *  server supplies an SSE-writing sink). */
export type EventSink = (e: StatusEvent) => void;

export const noopEventSink: EventSink = () => {};
