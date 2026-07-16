import { expect, test } from 'bun:test';
import {
  recordPullProgressTick,
  withModelPullSpan,
} from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

test('withModelPullSpan opens a model.pull root; recordPullProgressTick nests a short-lived child under it', async () => {
  const { exporter, provider } = registerTestProvider();
  await withModelPullSpan(
    { runtime: 'Ollama', modelRef: 'qwen3.5:9b' },
    async (rec) => {
      await recordPullProgressTick({
        phase: 'downloading',
        percent: 42,
        bytesCompleted: 420,
        bytesTotal: 1000,
        speedBytesPerSec: 100,
      });
      rec.outcome('done');
    },
  );
  const spans = exporter.getFinishedSpans();
  const root = spans.find((s) => s.name === 'model.pull');
  const tick = spans.find((s) => s.name === 'model.pull.progress');
  expect(root).toBeDefined();
  expect(tick).toBeDefined();
  expect(tick?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
  expect(tick?.attributes['model.pull.progress.percent']).toBe(42);
  await provider.shutdown();
});

test("a throwing fn marks the model.pull root ERROR (inSpan's standard catch)", async () => {
  const { exporter, provider } = registerTestProvider();
  await withModelPullSpan({ runtime: 'Ollama', modelRef: 'x' }, async () => {
    throw new Error('boom');
  }).catch(() => {});
  const root = exporter.getFinishedSpans().find((s) => s.name === 'model.pull');
  expect(root?.status.code).toBe(2); // SpanStatusCode.ERROR
  await provider.shutdown();
});
