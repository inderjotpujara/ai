import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  BasicTracerProvider,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR,
  withMcpMountSpan,
  withToolSpan,
} from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

// Companion to tool-span.test.ts's no-op-tracer pass-through/error-propagation
// checks: this file registers a real InMemory-backed provider and asserts the
// actual span/event emission that §16 of docs/architecture.md describes.
describe('withToolSpan / withMcpMountSpan span emission', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    ({ exporter, provider } = registerTestProvider());
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  test('withToolSpan emits a workflow.tool span with gen_ai.tool.name', async () => {
    await withToolSpan('read_file', async () => 'ok');
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'workflow.tool');
    expect(span).toBeDefined();
    expect(span?.attributes[ATTR.TOOL_NAME]).toBe('read_file');
  });

  test('withMcpMountSpan emits an mcp.mount span with a mcp.server.mount event', async () => {
    await withMcpMountSpan(async (record) => {
      record('sqlite', 'mounted', 3);
      return 'ok';
    });
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'mcp.mount');
    expect(span).toBeDefined();
    const event = span?.events.find((e) => e.name === 'mcp.server.mount');
    expect(event).toBeDefined();
    expect(event?.attributes?.[ATTR.MCP_SERVER]).toBe('sqlite');
    expect(event?.attributes?.[ATTR.MCP_MOUNT_OUTCOME]).toBe('mounted');
  });

  test('withMcpMountSpan tags the mount event with MCP_TRANSPORT per server (stdio + http)', async () => {
    await withMcpMountSpan(async (record) => {
      record('sqlite', 'mounted', 3, 'stdio');
      record('remote-api', 'mounted', 5, 'http');
      return 'ok';
    });
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'mcp.mount');
    expect(span).toBeDefined();
    const events = span?.events.filter((e) => e.name === 'mcp.server.mount');
    expect(events).toHaveLength(2);
    const stdioEvent = events?.find(
      (e) => e.attributes?.[ATTR.MCP_SERVER] === 'sqlite',
    );
    const httpEvent = events?.find(
      (e) => e.attributes?.[ATTR.MCP_SERVER] === 'remote-api',
    );
    expect(stdioEvent?.attributes?.[ATTR.MCP_TRANSPORT]).toBe('stdio');
    expect(httpEvent?.attributes?.[ATTR.MCP_TRANSPORT]).toBe('http');
  });

  test('withMcpMountSpan omits MCP_TRANSPORT when the caller does not supply one', async () => {
    await withMcpMountSpan(async (record) => {
      record('needs-consent', 'consent not granted');
      return 'ok';
    });
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'mcp.mount');
    const event = span?.events.find((e) => e.name === 'mcp.server.mount');
    expect(event?.attributes?.[ATTR.MCP_TRANSPORT]).toBeUndefined();
  });
});
