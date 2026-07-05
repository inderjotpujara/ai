import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { ATTR, withMcpMountSpan } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

test('exposes MCP_AUTH_* ATTR keys', () => {
  expect(ATTR.MCP_AUTH_OUTCOME).toBe('mcp.auth.outcome');
  expect(ATTR.MCP_AUTH_KIND).toBe('mcp.auth.kind');
});

describe('mcp.server.auth event emission', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    ({ exporter, provider } = registerTestProvider());
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  test('recordAuth emits an mcp.server.auth event with server/kind/outcome and no secrets', async () => {
    await withMcpMountSpan(async (record, recordAuth) => {
      recordAuth('oauth-server', 'oauth', 'token-reused');
      record('oauth-server', 'mounted', 1, 'http');
      return undefined;
    });
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'mcp.mount');
    expect(span).toBeDefined();
    const authEvent = span?.events.find((e) => e.name === 'mcp.server.auth');
    expect(authEvent).toBeDefined();
    expect(authEvent?.attributes?.[ATTR.MCP_SERVER]).toBe('oauth-server');
    expect(authEvent?.attributes?.[ATTR.MCP_AUTH_KIND]).toBe('oauth');
    expect(authEvent?.attributes?.[ATTR.MCP_AUTH_OUTCOME]).toBe('token-reused');
    // no secret-shaped values (tokens, headers) leak into the event attrs
    const values = Object.values(authEvent?.attributes ?? {});
    expect(values.every((v) => typeof v !== 'object')).toBe(true);
  });

  test('the existing record() recorder still works unchanged alongside recordAuth', async () => {
    const out = await withMcpMountSpan(async (record) => {
      record('x', 'mounted', 3, 'stdio');
      return 42;
    });
    expect(out).toBe(42);
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'mcp.mount');
    expect(span?.attributes[ATTR.MCP_SERVER_COUNT]).toBe(1);
    expect(span?.attributes[ATTR.MCP_TOOL_COUNT]).toBe(3);
  });
});
