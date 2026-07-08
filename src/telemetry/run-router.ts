import {
  type Context,
  context,
  createContextKey,
  trace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const RUN_ID_KEY = createContextKey('agent.run.id');

/** Routes each span to the processors registered for the run active in its context. */
class RunRoutingSpanProcessor implements SpanProcessor {
  private readonly byRun = new Map<string, SpanProcessor[]>();
  private readonly spanRun = new WeakMap<ReadableSpan, string>();

  register(runId: string, procs: SpanProcessor[]) {
    this.byRun.set(runId, procs);
  }

  async unregister(runId: string) {
    const procs = this.byRun.get(runId);
    if (!procs) return;
    this.byRun.delete(runId);
    await Promise.all(procs.map((p) => p.forceFlush().catch(() => {})));
    await Promise.all(procs.map((p) => p.shutdown().catch(() => {})));
  }

  onStart(span: Span, parentContext: Context) {
    const runId = parentContext.getValue(RUN_ID_KEY) as string | undefined;
    if (runId) this.spanRun.set(span, runId);
  }

  onEnd(span: ReadableSpan) {
    const runId = this.spanRun.get(span);
    const procs = runId ? this.byRun.get(runId) : undefined;
    if (procs) for (const p of procs) p.onEnd(span);
  }

  async forceFlush() {
    for (const procs of this.byRun.values())
      await Promise.all(procs.map((p) => p.forceFlush()));
  }

  async shutdown() {
    for (const runId of [...this.byRun.keys()]) await this.unregister(runId);
  }
}

let router: RunRoutingSpanProcessor | undefined;
let provider: BasicTracerProvider | undefined;
let contextManagerSet = false;

/** Installs ONE global provider fronted by the single routing processor, plus
 *  the async-hooks context manager. The router and provider are built exactly
 *  once (so per-run registrations accumulate on a stable router), but the
 *  provider is (re)asserted as the global tracer provider on every call: OTel
 *  keeps the global on `globalThis` and something else may have swapped it (the
 *  InMemory test provider does this), so re-asserting reclaims it. Because the
 *  provider instance is stable and routing is by the run id in the active
 *  context — not by which provider a span came through — concurrent runs stay
 *  correctly isolated across a re-assert. */
export function ensureGlobalTelemetry(): RunRoutingSpanProcessor {
  if (!contextManagerSet) {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    contextManagerSet = true;
  }
  if (!router || !provider) {
    router = new RunRoutingSpanProcessor();
    provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'local-agent-framework',
      }),
      spanProcessors: [router],
    });
  }
  trace.disable();
  trace.setGlobalTracerProvider(provider);
  return router;
}

export function registerRun(runId: string, procs: SpanProcessor[]): void {
  ensureGlobalTelemetry().register(runId, procs);
}

export function unregisterRun(runId: string): Promise<void> {
  return ensureGlobalTelemetry().unregister(runId);
}

/** Runs `fn` with `runId` bound into the active OTel context so every span
 *  emitted inside is routed to that run's processors. */
export function withRunContext<T>(runId: string, fn: () => T): T {
  return context.with(context.active().setValue(RUN_ID_KEY, runId), fn);
}
