import { appendFile } from 'node:fs/promises';
import {
  type ExportResult,
  ExportResultCode,
  hrTimeToMicroseconds,
} from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

/** One serialized span per line in runs/<id>/spans.jsonl. */
export type SpanRecord = {
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  startUnixNano: number;
  endUnixNano: number;
  durationMs: number;
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  events: {
    name: string;
    timeUnixNano: number;
    attributes?: Record<string, unknown>;
  }[];
};

function toRecord(span: ReadableSpan): SpanRecord {
  const ctx = span.spanContext();
  return {
    name: span.name,
    kind: span.kind,
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    startUnixNano: hrTimeToMicroseconds(span.startTime) * 1000,
    endUnixNano: hrTimeToMicroseconds(span.endTime) * 1000,
    durationMs: hrTimeToMicroseconds(span.duration) / 1000,
    status: { code: span.status.code, message: span.status.message },
    attributes: { ...span.attributes },
    events: span.events.map((e) => ({
      name: e.name,
      timeUnixNano: hrTimeToMicroseconds(e.time) * 1000,
      attributes: e.attributes ? { ...e.attributes } : undefined,
    })),
  };
}

/** Best-effort local span sink. Never throws into the run. */
export class JsonlFileExporter implements SpanExporter {
  constructor(private readonly filePath: string) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    const payload = `${spans.map((s) => JSON.stringify(toRecord(s))).join('\n')}\n`;
    appendFile(this.filePath, payload)
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error: Error) =>
        resultCallback({ code: ExportResultCode.FAILED, error }),
      );
  }

  async shutdown(): Promise<void> {}
}
