import { LegacyOpenTelemetry } from '@ai-sdk/otel';
import {
  type Context,
  type Span,
  type SpanOptions,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import { registerTelemetry } from 'ai';

/** Instrumentation-scope name for AI-SDK spans (matches the AI SDK's own `ai`
 *  scope). Only used as the argument to `trace.getTracer`; span *names* come
 *  from the SDK operation id (e.g. `ai.generateText`). */
const AI_SDK_TRACER_NAME = 'ai';

/**
 * A `Tracer` that re-resolves the CURRENT global tracer provider on every span
 * instead of capturing one. `@ai-sdk/otel`'s integration reads its tracer ONCE
 * in its constructor (`options.tracer ?? trace.getTracer(...)`), so a single
 * process-global registration would otherwise freeze onto whichever provider
 * was global at init. Our telemetry swaps the global tracer provider per run
 * (`run-router.ts` `trace.setGlobalTracerProvider`, re-asserted each run) and
 * tests swap in an InMemory provider — so the integration must follow those
 * swaps. Delegating each `startSpan`/`startActiveSpan` to a freshly-fetched
 * `trace.getTracer(...)` reproduces exactly the v6 behavior, where the AI SDK
 * resolved the tracer lazily per call.
 */
const dynamicTracer: Tracer = {
  startSpan(name: string, options?: SpanOptions, context?: Context): Span {
    return trace
      .getTracer(AI_SDK_TRACER_NAME)
      .startSpan(name, options, context);
  },
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    ...rest: unknown[]
  ): ReturnType<F> {
    const tracer = trace.getTracer(AI_SDK_TRACER_NAME);
    return (
      tracer.startActiveSpan as (
        name: string,
        ...args: unknown[]
      ) => ReturnType<F>
    )(name, ...rest);
  },
};

let registered = false;

/**
 * Register the AI-SDK OpenTelemetry integration exactly once for the process.
 *
 * AI SDK v7 extracted OpenTelemetry out of the core `ai` package: passing
 * `telemetry: { … }` to `generateText`/`streamText` no longer emits spans on
 * its own — an integration must be registered via `registerTelemetry`. We use
 * `LegacyOpenTelemetry` (not the new `OpenTelemetry`) so the emitted spans keep
 * their v6 shape — span name `ai.generateText` and the `ai.telemetry.functionId`
 * attribute — which our run viewer, span fixtures, and tests already consume;
 * the new class would rename spans to GenAI-semconv (`chat <model>`) and move
 * the id to `gen_ai.agent.name`, a behavior change beyond this upgrade's scope.
 *
 * `registerTelemetry` accumulates onto a process-global array, so this is
 * guarded to run once (duplicate registration would double-emit every span).
 */
export function ensureAiSdkTelemetry(): void {
  if (registered) return;
  registered = true;
  registerTelemetry(new LegacyOpenTelemetry({ tracer: dynamicTracer }));
}
