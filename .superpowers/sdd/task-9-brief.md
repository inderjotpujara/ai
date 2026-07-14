### Task 9: Telemetry — `server.request` span helper

**Files:**
- Modify: `src/telemetry/spans.ts`
- Test: `tests/telemetry/server-request-span.test.ts`

**Interfaces:**
- Consumes: existing `inSpan`, `ATTR`, `trace`, `SpanStatusCode` in `src/telemetry/spans.ts`; test uses `tests/helpers/otel-test-provider.ts` `registerTestProvider()`.
- Produces: new `ATTR` keys `SERVER_ROUTE`/`SERVER_METHOD`/`SERVER_STATUS`/`SERVER_DURATION_MS`/`SERVER_PRINCIPAL`; `withServerRequestSpan<T>(info: { route: string; method: string; principal?: string }, fn: (rec: { status: (code: number) => void }) => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing span test**

```ts
// tests/telemetry/server-request-span.test.ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SpanStatusCode } from '@opentelemetry/api';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';
import { withServerRequestSpan } from '../../src/telemetry/spans.ts';

// registerTestProvider() returns { exporter, provider }; shutdown is on .provider.
let h: ReturnType<typeof registerTestProvider>;
beforeAll(() => {
  h = registerTestProvider();
});
afterAll(() => h.provider.shutdown());

test('withServerRequestSpan emits a server.request span with route/method/status/principal', async () => {
  await withServerRequestSpan({ route: '/api/health', method: 'GET' }, async (rec) => {
    rec.status(200);
  });
  const span = h.exporter.getFinishedSpans().find((s) => s.name === 'server.request');
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
  const span = h.exporter.getFinishedSpans().find((s) => s.name === 'server.request' && s.attributes['server.route'] === '/api/boom');
  expect(span?.status.code).toBe(SpanStatusCode.ERROR);
});
```

(Verified 2026-07-14: `registerTestProvider()` in `tests/helpers/otel-test-provider.ts` returns `{ exporter: InMemorySpanExporter; provider }` — read spans via `h.exporter.getFinishedSpans()`, shut down via `h.provider.shutdown()`, exactly as above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/server-request-span.test.ts`
Expected: FAIL — `withServerRequestSpan` is not exported.

- [ ] **Step 3: Add the server ATTR constants**

In `src/telemetry/spans.ts`, inside the `ATTR` object, add (alongside the other groups, e.g. after the `VOICE_*` block, before the closing `} as const;`):

```ts
  // Server / web BFF (Slice 30b)
  SERVER_ROUTE: 'server.route',
  SERVER_METHOD: 'http.request.method',
  SERVER_STATUS: 'http.response.status_code',
  SERVER_DURATION_MS: 'server.duration_ms',
  /** Request principal/owner; reserved "local" now, upgrades to audit-grade in Slice 35. */
  SERVER_PRINCIPAL: 'server.principal',
```

- [ ] **Step 4: Add the `withServerRequestSpan` helper**

In `src/telemetry/spans.ts`, append (near the other `with*Span` helpers, e.g. after `withRunSpan`):

```ts
/**
 * Span for one HTTP request handled by the web BFF (Slice 30b). Follows the
 * recorder-callback pattern (`withRuntimeSpan`): opens a `server.request` span,
 * sets route/method + the reserved principal, runs `fn` (which reports the final
 * status via `rec.status`), records the duration in a `finally`, and — via
 * `inSpan` — records an error status if `fn` throws.
 */
export function withServerRequestSpan<T>(
  info: { route: string; method: string; principal?: string },
  fn: (rec: { status: (code: number) => void }) => Promise<T>,
): Promise<T> {
  return inSpan('server.request', async (span) => {
    const startedAt = performance.now();
    span.setAttribute(ATTR.SERVER_ROUTE, info.route);
    span.setAttribute(ATTR.SERVER_METHOD, info.method);
    span.setAttribute(ATTR.SERVER_PRINCIPAL, info.principal ?? 'local');
    try {
      return await fn({
        status: (code) => span.setAttribute(ATTR.SERVER_STATUS, code),
      });
    } finally {
      span.setAttribute(
        ATTR.SERVER_DURATION_MS,
        Math.round(performance.now() - startedAt),
      );
    }
  });
}
```

- [ ] **Step 5: Run span test + typecheck to verify pass**

Run: `bun test tests/telemetry/server-request-span.test.ts && bun run typecheck`
Expected: PASS (2 tests) and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/telemetry/spans.ts tests/telemetry/server-request-span.test.ts
git commit -m "feat(telemetry): add server.request span helper for the web BFF"
```

---

