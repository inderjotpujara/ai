/**
 * Daemon + queue/job lifecycle telemetry (Slice 24 Increment 4, item 18).
 *
 * `createDaemon` (core.ts) records a `daemon.start`/`daemon.stop` span at the
 * two lifecycle edges so "when did this host boot / drain" is answerable
 * straight from the trace stream — the same observable-by-default discipline
 * every other subsystem follows (see telemetry/spans.ts). Task 30 grows this
 * module from the T27 minimal seam into the full span set item 18 calls for:
 * daemon start/stop PLUS the job lifecycle (`job.enqueue`/`job.run`/
 * `job.retry`/`job.cancel`) emitted from the enqueue route and the worker
 * pool. Every helper reuses `telemetry/spans.ts`'s `inSpan`/`ATTR` — no
 * parallel span-emission path — and is a no-op (non-recording span,
 * started+ended) when no tracer provider is registered, exactly like the rest
 * of the telemetry surface.
 */

import { type Span, trace } from '@opentelemetry/api';
import { RunOrigin } from '../contracts/index.ts';
import type { JobRecord } from '../queue/types.ts';
import { withRunContext } from '../telemetry/run-router.ts';
import { ATTR, inSpan } from '../telemetry/spans.ts';

const tracer = () => trace.getTracer('agent');

/** Record the daemon's boot as a `daemon.start` span (no-op when no tracer
 *  provider is registered — a non-recording span is returned + ended). */
export function recordDaemonStart(info: { pid: number }): void {
  const span = tracer().startSpan('daemon.start');
  span.setAttribute(ATTR.DAEMON_PID, info.pid);
  span.end();
}

/** Record the daemon's graceful drain as a `daemon.stop` span. */
export function recordDaemonStop(info: { pid: number }): void {
  const span = tracer().startSpan('daemon.stop');
  span.setAttribute(ATTR.DAEMON_PID, info.pid);
  span.end();
}

/** Every queue job dispatched through the daemon's worker pool carries
 *  `RunOrigin.Daemon` provenance — the SAME value `dispatch.ts`'s
 *  `markJobOrigin` writes to `runs/<runId>/origin` — so a job's spans
 *  agree with its run's `readRunOrigin()` projection. */
function setJobAttrs(span: Span, job: JobRecord): void {
  span.setAttribute(ATTR.JOB_ID, job.id);
  span.setAttribute(ATTR.JOB_KIND, job.kind);
  span.setAttribute(ATTR.JOB_PRIORITY, job.priority);
  span.setAttribute(ATTR.JOB_ORIGIN, RunOrigin.Daemon);
  if (job.runId) span.setAttribute(ATTR.RUN_ID, job.runId);
}

/** Record a job's admission to the queue as a `job.enqueue` span (called from
 *  `server/jobs/enqueue.ts` right after `JobStore.enqueue` persists it). Also
 *  tags the reserved request principal (mirrors `withServerRequestSpan`'s
 *  `server.principal`, "local" until Slice 35's audit-grade upgrade). */
export function recordJobEnqueue(job: JobRecord): void {
  const span = tracer().startSpan('job.enqueue');
  setJobAttrs(span, job);
  span.setAttribute(ATTR.SERVER_PRINCIPAL, 'local');
  span.end();
}

/** Root span for one job execution (`job.run`), wrapping the pool's
 *  claim→dispatch invocation. Runs `fn` inside `withRunContext(job.runId)` so
 *  every span the executor itself emits (e.g. `agent.run`) — not just this
 *  one — routes to that run's registered processors, the same nesting
 *  `withRunSpan` callers rely on elsewhere. Reuses `inSpan` (no parallel
 *  try/catch/finally): a thrown executor records an ERROR status here and
 *  still propagates to the pool's own retry/fail handling. */
export function withJobRunSpan<T>(
  job: JobRecord,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const runId = job.runId ?? job.id;
  return withRunContext(runId, () =>
    inSpan('job.run', async (span) => {
      setJobAttrs(span, job);
      span.setAttribute(ATTR.JOB_ATTEMPT, job.attempts);
      return fn(span);
    }),
  );
}

/** Record a failed job being re-queued for another attempt as a `job.retry`
 *  span (called from the pool AFTER `JobStore.markFailed` re-queues it —
 *  never for a terminal failure, which `job.run`'s ERROR status already
 *  covers). `job` should be the freshly re-read record so `job.attempt`
 *  reflects the attempt count that just failed. */
export function recordJobRetry(job: JobRecord): void {
  const span = tracer().startSpan('job.retry');
  setJobAttrs(span, job);
  span.setAttribute(ATTR.JOB_ATTEMPT, job.attempts);
  span.end();
}

/** Record a job cancellation as a `job.cancel` span (called from the pool's
 *  `cancel()` for a Running job, whose `AbortController` it owns). */
export function recordJobCancel(job: JobRecord): void {
  const span = tracer().startSpan('job.cancel');
  setJobAttrs(span, job);
  span.end();
}

/** Record an Overview-tab queue-health read as a `queue.stats.read` span. */
export function recordQueueStatsRead(): void {
  const span = tracer().startSpan('queue.stats.read');
  span.end();
}

/** Record an Overview-tab daemon-status read as a `daemon.status.read` span. */
export function recordDaemonStatusRead(): void {
  const span = tracer().startSpan('daemon.status.read');
  span.end();
}

/** Record a daemon-logs tail read as a `daemon.logs.read` span. */
export function recordDaemonLogsRead(): void {
  const span = tracer().startSpan('daemon.logs.read');
  span.end();
}
