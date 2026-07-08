import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { JsonlFileExporter } from './jsonl-exporter.ts';
import {
  ensureGlobalTelemetry,
  registerRun,
  unregisterRun,
} from './run-router.ts';

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

/** Register this run's processors on the shared router. No process-global swap:
 *  ONE global provider fans each span to the run active in its OTel context, so
 *  concurrent runs in one process stay isolated. Spans emitted inside this run
 *  must run under `withRunContext(runId, ...)` to be routed here. */
export function initRunTelemetry(
  runDir: string,
  runId: string,
): { shutdown: () => Promise<void> } {
  ensureGlobalTelemetry();
  // The JSONL exporter appends and does not create parents; ensure the run dir
  // exists so spans.jsonl is writable even when the caller did not pre-create it.
  mkdirSync(runDir, { recursive: true });
  registerRun(runId, buildProcessors(join(runDir, 'spans.jsonl')));
  return {
    shutdown: async () => {
      await unregisterRun(runId);
    },
  };
}
