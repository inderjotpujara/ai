import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { SpanRecord } from '../../src/telemetry/jsonl-exporter.ts';
import { JsonlFileExporter } from '../../src/telemetry/jsonl-exporter.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spans-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('writes one JSON line per ended span with parent linkage', async () => {
  const file = join(dir, 'spans.jsonl');
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new JsonlFileExporter(file))],
  });
  const tracer = provider.getTracer('test');
  const parent = tracer.startSpan('parent');
  parent.setAttribute('k', 'v');
  parent.end();
  await provider.shutdown();

  const lines = (await readFile(file, 'utf8'))
    .split('\n')
    .filter((l) => l.length > 0);
  expect(lines.length).toBe(1);
  const rec = JSON.parse(lines[0] as string) as SpanRecord;
  expect(rec.name).toBe('parent');
  expect(rec.parentSpanId).toBeNull();
  expect(rec.traceId).toHaveLength(32);
  expect(rec.spanId).toHaveLength(16);
  expect(rec.attributes.k).toBe('v');
  expect(typeof rec.durationMs).toBe('number');
});
