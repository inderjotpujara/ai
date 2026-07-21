/**
 * Trigger lifecycle telemetry (Slice 25, Task 8) — the observability surface
 * every later trigger-engine task (scheduler/watcher/webhook/fire) emits
 * through. Mirrors `daemon/spans.ts` exactly: reuses `telemetry/spans.ts`'s
 * `inSpan`/`ATTR` (no parallel span-emission path), and every helper is a
 * no-op (non-recording span, started+ended) when no tracer provider is
 * registered.
 *
 * NEVER set the webhook token or a trigger's `secretRef` value as a span
 * attribute — only the opaque trigger id/type/origin/outcome enums below.
 */

import { trace } from '@opentelemetry/api';
import { ATTR, inSpan } from '../telemetry/spans.ts';
import type { Trigger, TriggerOutcome } from './types.ts';

const tracer = () => trace.getTracer('agent');

function setTriggerAttrs(
  span: { setAttribute: (k: string, v: string | number | boolean) => void },
  t: Trigger,
): void {
  span.setAttribute(ATTR.TRIGGER_ID, t.id);
  span.setAttribute(ATTR.TRIGGER_TYPE, t.type);
  span.setAttribute(ATTR.TRIGGER_ORIGIN, t.origin);
}

/** Record a trigger's registration (create/enable) as a `trigger.register`
 *  span. */
export function recordTriggerRegister(t: Trigger): void {
  const span = tracer().startSpan('trigger.register');
  setTriggerAttrs(span, t);
  span.end();
}

/** Root span for one trigger firing attempt (`trigger.fire`). The body
 *  reports the terminal outcome via the returned recorder, mirroring
 *  `withJobRunSpan`'s recorder-callback shape. */
export function withTriggerFireSpan<T>(
  t: Trigger,
  fn: (rec: { outcome: (o: TriggerOutcome) => void }) => Promise<T>,
): Promise<T> {
  return inSpan('trigger.fire', async (span) => {
    setTriggerAttrs(span, t);
    return fn({
      outcome: (o) => span.setAttribute(ATTR.TRIGGER_OUTCOME, o),
    });
  });
}

/** Record a trigger firing being skipped (e.g. overlap guard) as a
 *  `trigger.skip` span, tagged with the outcome that explains why. */
export function recordTriggerSkip(t: Trigger, outcome: TriggerOutcome): void {
  const span = tracer().startSpan('trigger.skip');
  setTriggerAttrs(span, t);
  span.setAttribute(ATTR.TRIGGER_OUTCOME, outcome);
  span.end();
}
