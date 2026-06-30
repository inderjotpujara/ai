import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

let contextManagerSet = false;

/** Register a fresh InMemory-backed global provider for a test (public API, swappable). */
export function registerTestProvider(): {
  exporter: InMemorySpanExporter;
  provider: BasicTracerProvider;
} {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  if (!contextManagerSet) {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    contextManagerSet = true;
  }
  trace.disable();
  trace.setGlobalTracerProvider(provider);
  return { exporter, provider };
}
