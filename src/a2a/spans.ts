/**
 * A2A interop telemetry (Slice 31, Increment 1 — config/telemetry seam).
 *
 * Mirrors `src/daemon/spans.ts`'s idiom exactly: reuse `telemetry/spans.ts`'s
 * `inSpan`/`ATTR` — no parallel span-emission path — and every helper is a
 * no-op (non-recording span, started+end) when no tracer provider is
 * registered. `A2A_PEER_HOST` is HOST ONLY, never a full URL (privacy) — the
 * client-side helpers below never receive or set anything more than the host.
 */

import { trace } from '@opentelemetry/api';
import type { A2aMethod, TaskStateWire } from '../contracts/index.ts';
import { ATTR, inSpan } from '../telemetry/spans.ts';

const tracer = () => trace.getTracer('agent');

/** Record an Agent Card read as an `a2a.server.card` span (called from
 *  `server/a2a/card.ts` after computing the cache-hit outcome). */
export function recordA2aCard(info: { cacheHit: boolean }): void {
  const span = tracer().startSpan('a2a.server.card');
  span.setAttribute('a2a.card.cache_hit', info.cacheHit);
  span.end();
}

/** Root span for one inbound A2A JSON-RPC task (`a2a.server.task`), wrapping
 *  the EXPOSE-side handling of a `POST /api/a2a` request in `server/a2a/rpc.ts`.
 *  The body reports the task's lifecycle state transitions and terminal
 *  outcome via the returned recorder — `rec.taskState` sets `A2A_TASK_STATE`,
 *  `rec.outcome` sets `A2A_OUTCOME`. */
export function withA2aServerTaskSpan<T>(
  info: { method: A2aMethod; skillId?: string },
  fn: (rec: {
    taskState: (s: TaskStateWire) => void;
    outcome: (o: string) => void;
  }) => Promise<T>,
): Promise<T> {
  return inSpan('a2a.server.task', async (span) => {
    span.setAttribute(ATTR.A2A_METHOD, info.method);
    if (info.skillId !== undefined) {
      span.setAttribute(ATTR.A2A_SKILL_ID, info.skillId);
    }
    return fn({
      taskState: (s) => span.setAttribute(ATTR.A2A_TASK_STATE, s),
      outcome: (o) => span.setAttribute(ATTR.A2A_OUTCOME, o),
    });
  });
}

/** Record a CONSUME-side remote-agent discovery attempt as an
 *  `a2a.client.discover` span (called from `a2a/remotes.ts`). `peerHost` is
 *  the host ONLY — never a full URL. */
export function recordA2aClientDiscover(info: {
  peerHost: string;
  outcome: string;
}): void {
  const span = tracer().startSpan('a2a.client.discover');
  span.setAttribute(ATTR.A2A_PEER_HOST, info.peerHost);
  span.setAttribute(ATTR.A2A_OUTCOME, info.outcome);
  span.end();
}

/** Record a CONSUME-side outbound task invocation as an `a2a.client.invoke`
 *  span (called from the `delegate_to_<name>` specialist mount path).
 *  `peerHost` is the host ONLY — never a full URL. */
export function recordA2aClientInvoke(info: {
  peerHost: string;
  method: A2aMethod;
  taskState?: TaskStateWire;
}): void {
  const span = tracer().startSpan('a2a.client.invoke');
  span.setAttribute(ATTR.A2A_PEER_HOST, info.peerHost);
  span.setAttribute(ATTR.A2A_METHOD, info.method);
  if (info.taskState !== undefined) {
    span.setAttribute(ATTR.A2A_TASK_STATE, info.taskState);
  }
  span.end();
}
