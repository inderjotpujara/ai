/**
 * Daemon lifecycle telemetry (Slice 24 Increment 4 seam; enriched in Task 30).
 *
 * `createDaemon` (core.ts) records a `daemon.start`/`daemon.stop` span at the
 * two lifecycle edges so "when did this host boot / drain" is answerable
 * straight from the trace stream — the same observable-by-default discipline
 * every other subsystem follows (see telemetry/spans.ts). Kept as its own
 * module (rather than folded into telemetry/spans.ts) because the full daemon
 * span set — boot-recovery counts, drain duration, orphan reconcile tallies —
 * lands in Task 30; this is the minimal, real emission it grows from.
 */

import { trace } from '@opentelemetry/api';

/** Owner/pid attribute for the two daemon lifecycle spans. Task 30 promotes
 *  this into the central `ATTR` map when the full span set lands. */
const ATTR_DAEMON_PID = 'daemon.pid';

const tracer = () => trace.getTracer('agent');

/** Record the daemon's boot as a `daemon.start` span (no-op when no tracer
 *  provider is registered — a non-recording span is returned + ended). */
export function recordDaemonStart(info: { pid: number }): void {
  const span = tracer().startSpan('daemon.start');
  span.setAttribute(ATTR_DAEMON_PID, info.pid);
  span.end();
}

/** Record the daemon's graceful drain as a `daemon.stop` span. */
export function recordDaemonStop(info: { pid: number }): void {
  const span = tracer().startSpan('daemon.stop');
  span.setAttribute(ATTR_DAEMON_PID, info.pid);
  span.end();
}
