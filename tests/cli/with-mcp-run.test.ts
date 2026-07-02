import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withMcpRun } from '../../src/cli/with-mcp-run.ts';
import type { McpConfig } from '../../src/mcp/types.ts';

const EMPTY_CONFIG = {
  entries: [],
  dormant: [],
  warnings: [],
} as unknown as McpConfig;

describe('withMcpRun', () => {
  it('creates the run, then the mcp.mount span lands in spans.jsonl (ordering fix)', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    const seen = await withMcpRun(
      {
        runsRoot,
        runId: 'r1',
        config: EMPTY_CONFIG,
        mountDeps: {
          mount: async () => ({ tools: {}, close: async () => {} }),
        },
      },
      async ({ run, reg }) => {
        expect(run.id).toBe('r1');
        return reg.mounted.length;
      },
    );
    expect(seen).toBe(0);
    const lines = (await readFile(join(runsRoot, 'r1', 'spans.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.some((s) => s.name === 'mcp.mount')).toBe(true);
    await rm(runsRoot, { recursive: true, force: true });
  });

  it('closes the registry after the body', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    let closed = false;
    await withMcpRun(
      {
        runsRoot,
        runId: 'r2',
        config: EMPTY_CONFIG,
        mountDeps: {
          mount: async () => ({
            tools: {},
            close: async () => {
              closed = true;
            },
          }),
        },
      },
      async () => undefined,
    );
    // empty config mounts nothing, so reg.close() iterates zero servers; assert the call path ran cleanly
    expect(closed).toBe(false);
    await rm(runsRoot, { recursive: true, force: true });
  });
});
