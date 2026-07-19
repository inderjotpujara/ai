import { LegacyOpenTelemetry } from '@ai-sdk/otel';
import {
  type Context,
  type Span,
  type SpanOptions,
  type Tracer,
  trace,
} from '@opentelemetry/api';

/** Instrumentation-scope name for AI-SDK spans (matches the AI SDK's own `ai`
 *  scope). Only used as the argument to `trace.getTracer`; span *names* come
 *  from the SDK operation id (e.g. `ai.generateText`). */
const AI_SDK_TRACER_NAME = 'ai';

/**
 * A `Tracer` that re-resolves the CURRENT global tracer provider on every span
 * instead of capturing one. `@ai-sdk/otel`'s integration reads its tracer ONCE
 * in its constructor (`options.tracer ?? trace.getTracer(...)`), so the single
 * integration instance below would otherwise freeze onto whichever provider was
 * global at module load. Our telemetry swaps the global tracer provider per run
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

/**
 * The AI-SDK OpenTelemetry integration, passed PER CALL via
 * `telemetry.integrations` — not registered globally.
 *
 * AI SDK v7 extracted OpenTelemetry out of the core `ai` package: passing
 * `telemetry: { … }` to `generateText`/`streamText` no longer emits spans on
 * its own — an integration must supply the OTel bridge. The SDK offers two ways
 * to attach one: `registerTelemetry(...)` (PROCESS-GLOBAL, opt-out — every
 * subsequent AI-SDK call in the process emits spans) or a per-call
 * `telemetry.integrations` array (scoped to that one call). The dispatcher
 * prefers locally-passed integrations and only falls back to the global
 * registry when a call passes none (see `createTelemetryDispatcher` in
 * `node_modules/ai/dist/index.js`: `localIntegrations != null ? … :
 * getGlobalTelemetryIntegrations()`).
 *
 * We deliberately do NOT call `registerTelemetry`. v6 telemetry was opt-in and
 * only `runAgent` opted in; a global registration would flip that to opt-out at
 * PROCESS scope, so builder/verify `generateText` and memory `embedMany` — call
 * sites that passed no telemetry option and emitted nothing in v6 — would start
 * emitting `ai.*` spans, inflating run-viewer token totals and polluting traces.
 * Instead `runAgent` passes THIS instance via `telemetry.integrations`, so only
 * its `generateText`/`streamText` calls emit `ai.*` spans, exactly as in v6.
 *
 * We use `LegacyOpenTelemetry` (not the new `OpenTelemetry`) so the emitted
 * spans keep their v6 shape — span name `ai.generateText` and the
 * `ai.telemetry.functionId` attribute — which our run viewer, span fixtures,
 * and tests already consume; the new class would rename spans to GenAI-semconv
 * (`chat <model>`) and move the id to `gen_ai.agent.name`, a behavior change
 * beyond this upgrade's scope. It is built with `dynamicTracer` (above) so its
 * spans still follow run-router's per-run provider swaps and the InMemory test
 * provider. Constructed once at module load and reused across calls.
 */
export const aiSdkTelemetryIntegration = new LegacyOpenTelemetry({
  tracer: dynamicTracer,
});
