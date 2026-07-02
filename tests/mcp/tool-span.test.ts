import { describe, expect, it } from 'bun:test';
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
