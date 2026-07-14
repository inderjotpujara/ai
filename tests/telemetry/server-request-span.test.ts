import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SpanStatusCode } from '@opentelemetry/api';
import { withServerRequestSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

// registerTestProvider() returns { exporter, provider }; shutdown is on .provider.
let h: ReturnType<typeof registerTestProvider>;
beforeAll(() => {
  h = registerTestProvider();
});
afterAll(() => h.provider.shutdown());

test('withServerRequestSpan emits a server.request span with route/method/status/principal', async () => {
  await withServerRequestSpan(
    { route: '/api/health', method: 'GET' },
    async (rec) => {
      rec.status(200);
    },
  );
  const span = h.exporter
    .getFinishedSpans()
    .find((s) => s.name === 'server.request');
  expect(span).toBeDefined();
  expect(span?.attributes['server.route']).toBe('/api/health');
  expect(span?.attributes['http.request.method']).toBe('GET');
  expect(span?.attributes['http.response.status_code']).toBe(200);
  expect(span?.attributes['server.principal']).toBe('local');
  expect(typeof span?.attributes['server.duration_ms']).toBe('number');
});

test('a throwing handler records an error status and still ends the span', async () => {
  await expect(
    withServerRequestSpan({ route: '/api/boom', method: 'POST' }, async () => {
      throw new Error('kaboom');
    }),
  ).rejects.toThrow('kaboom');
  const span = h.exporter
    .getFinishedSpans()
    .find(
      (s) =>
        s.name === 'server.request' &&
        s.attributes['server.route'] === '/api/boom',
    );
  expect(span?.status.code).toBe(SpanStatusCode.ERROR);
});
