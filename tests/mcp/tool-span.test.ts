import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRunTelemetry } from '../../src/telemetry/provider.ts';
import { withMcpMountSpan, withToolSpan } from '../../src/telemetry/spans.ts';

// No provider initialized → no-op tracer; helpers must pass results through
// and propagate errors (the provider-attached path is exercised by run-viewer live tests).
describe('withToolSpan', () => {
  it('passes the function result through', async () => {
    expect(await withToolSpan('echo', async () => 42)).toBe(42);
  });
  it('propagates errors', async () => {
    await expect(
      withToolSpan('boom', async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
  });
});

describe('withMcpMountSpan', () => {
  it('hands the recorder to the body and returns its result', async () => {
    const out = await withMcpMountSpan(async (record) => {
      record('file-tools', 'mounted', 1);
      record('gh', 'dormant');
      return 'ok';
    });
    expect(out).toBe('ok');
  });
});

describe('withMcpMountSpan root-span counts', () => {
  it('records mounted-server count and summed tool count (not a raw record count)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mountspan-'));
    const tel = initRunTelemetry(dir);
    await withMcpMountSpan(async (record) => {
      record('a', 'mounted', 3);
      record('b', 'mounted', 2);
      record('c', 'consent not granted'); // skipped
      record('d', 'dormant');
      return 'x';
    });
    await tel.shutdown();
    const lines = (await readFile(join(dir, 'spans.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const mount = lines.find((s) => s.name === 'mcp.mount');
    expect(mount).toBeDefined();
    expect(mount.attributes['mcp.server.count']).toBe(2);
    expect(mount.attributes['mcp.tool.count']).toBe(5);
    expect(
      mount.events.filter(
        (e: { name: string }) => e.name === 'mcp.server.mount',
      ),
    ).toHaveLength(4);
    await rm(dir, { recursive: true, force: true });
  });
});
