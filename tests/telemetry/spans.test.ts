import { afterEach, beforeEach, expect, test } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR,
  recordEvict,
  setRunOutcome,
  withDelegationSpan,
  withRunSpan,
} from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;
beforeEach(() => {
  ({ exporter, provider } = registerTestProvider());
});
afterEach(async () => {
  await provider.shutdown();
  exporter.reset();
});

test('delegation span nests under the run span (Bun ALS context propagation)', async () => {
  await withRunSpan('run-x', 'do a thing', async () => {
    setRunOutcome({ kind: 'answer' });
    await withDelegationSpan('file_qa', async () => {
      recordEvict('old:model', 123, 'lru-fit');
    });
  });
  const spans = exporter.getFinishedSpans();
  const run = spans.find((s) => s.name === 'agent.run');
  const del = spans.find((s) => s.name === 'agent.delegation');
  expect(run).toBeDefined();
  expect(del).toBeDefined();
  expect(del?.parentSpanContext?.spanId).toBe(run?.spanContext().spanId);
  expect(run?.attributes[ATTR.RUN_ID]).toBe('run-x');
  expect(run?.attributes[ATTR.OUTCOME]).toBe('answer');
  expect(del?.attributes[ATTR.DELEGATION_TARGET]).toBe('file_qa');
  expect(del?.events.find((e) => e.name === 'agent.model.evict')).toBeDefined();
});

test('resource outcome sets ERROR status on the run span', async () => {
  await withRunSpan('run-y', 'x', async () => {
    setRunOutcome({ kind: 'resource', message: 'no fit' });
  });
  const run = exporter.getFinishedSpans().find((s) => s.name === 'agent.run');
  expect(run?.status.code).toBe(2); // SpanStatusCode.ERROR
});
