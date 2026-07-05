import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { RuntimeKind } from '../../src/core/types.ts';
import { ATTR, withRuntimeSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

test('withRuntimeSpan runs the body and exposes a recorder', async () => {
  const out = await withRuntimeSpan(RuntimeKind.LlamaCpp, async (rec) => {
    rec.applied(8192, 8192, 'spawned', 'relaunch');
    return 7;
  });
  expect(out).toBe(7);
  expect(ATTR.RUNTIME_CONTEXT_APPLIED).toBe('runtime.context.applied');
});

test('exposes RUNTIME_* ATTR keys', () => {
  expect(ATTR.RUNTIME_KIND).toBe('runtime.kind');
  expect(ATTR.RUNTIME_CONTEXT_CAPABILITY).toBe('runtime.context.capability');
  expect(ATTR.RUNTIME_CONTEXT_REQUESTED).toBe('runtime.context.requested');
  expect(ATTR.RUNTIME_CONTEXT_APPLIED).toBe('runtime.context.applied');
  expect(ATTR.RUNTIME_WARM_OUTCOME).toBe('runtime.warm.outcome');
});

describe('runtime.warm span emission', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    ({ exporter, provider } = registerTestProvider());
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  test('sets RUNTIME_KIND, capability, requested/applied ctx, and outcome', async () => {
    await withRuntimeSpan(RuntimeKind.MlxServer, async (rec) => {
      rec.applied(8192, 8192, 'spawned', 'relaunch');
      return 'ok';
    });
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'runtime.warm');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.RUNTIME_KIND]).toBe(RuntimeKind.MlxServer);
    expect(span?.attributes[ATTR.RUNTIME_CONTEXT_CAPABILITY]).toBe('relaunch');
    expect(span?.attributes[ATTR.RUNTIME_CONTEXT_REQUESTED]).toBe(8192);
    expect(span?.attributes[ATTR.RUNTIME_CONTEXT_APPLIED]).toBe(8192);
    expect(span?.attributes[ATTR.RUNTIME_WARM_OUTCOME]).toBe('spawned');
  });

  test('omits RUNTIME_CONTEXT_APPLIED for a fixed-context runtime (MLX limitation observable)', async () => {
    await withRuntimeSpan(RuntimeKind.MlxServer, async (rec) => {
      rec.applied(8192, undefined, 'spawned', 'fixed');
      return 'ok';
    });
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'runtime.warm');
    expect(span?.attributes[ATTR.RUNTIME_CONTEXT_APPLIED]).toBeUndefined();
    expect(span?.attributes[ATTR.RUNTIME_CONTEXT_CAPABILITY]).toBe('fixed');
    expect(span?.attributes[ATTR.RUNTIME_CONTEXT_REQUESTED]).toBe(8192);
  });

  test('propagates the body error and still ends the span', async () => {
    await expect(
      withRuntimeSpan(RuntimeKind.LlamaCpp, async (rec) => {
        rec.applied(4096, undefined, 'failed', 'relaunch');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'runtime.warm');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.RUNTIME_WARM_OUTCOME]).toBe('failed');
  });
});
