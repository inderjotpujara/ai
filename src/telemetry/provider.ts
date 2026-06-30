import { join } from 'node:path';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { JsonlFileExporter } from './jsonl-exporter.ts';

/** Whether prompts/responses/tool-IO are captured. Default on; AGENT_TELEMETRY_RECORD_IO=0 disables. */
export function recordIoEnabled(): boolean {
  return process.env.AGENT_TELEMETRY_RECORD_IO !== '0';
}

/** JSONL always; OTLP/HTTP added iff AGENT_OTLP_ENDPOINT is set (the swappable-backend seam). */
export function buildProcessors(spansFilePath: string): SpanProcessor[] {
  const processors: SpanProcessor[] = [
    new SimpleSpanProcessor(new JsonlFileExporter(spansFilePath)),
  ];
  const endpoint = process.env.AGENT_OTLP_ENDPOINT;
  if (endpoint) {
    processors.push(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint })),
    );
  }
  return processors;
}

let contextManagerSet = false;

/** Register a per-run global TracerProvider writing to runDir/spans.jsonl. */
export function initRunTelemetry(runDir: string): {
  shutdown: () => Promise<void>;
} {
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'local-agent-framework',
    }),
    spanProcessors: buildProcessors(join(runDir, 'spans.jsonl')),
  });
  if (!contextManagerSet) {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    contextManagerSet = true;
  }
  trace.setGlobalTracerProvider(provider);
  return {
    shutdown: async () => {
      await provider.shutdown();
    },
  };
}
