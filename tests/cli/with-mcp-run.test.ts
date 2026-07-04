import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withMcpRun } from '../../src/cli/with-mcp-run.ts';
import { type McpConfig, McpTransportKind } from '../../src/mcp/types.ts';

const EMPTY_CONFIG = {
  entries: [],
  dormant: [],
  warnings: [],
} as unknown as McpConfig;

const ONE_SERVER_CONFIG: McpConfig = {
  entries: [
    {
      kind: McpTransportKind.Stdio,
      name: 'x',
      command: 'echo',
      args: [],
      env: {},
      raw: { command: 'echo', args: [] },
    },
  ],
  dormant: [],
  warnings: [],
};

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
    const approvalsFile = join(runsRoot, 'approvals.json');
    const order: string[] = [];
    let mountedCount = -1;
    await withMcpRun(
      {
        runsRoot,
        runId: 'r2',
        config: ONE_SERVER_CONFIG,
        mountDeps: {
          consent: { autoYes: true },
          approvalsFile,
          mount: async () => ({
            tools: {},
            close: async () => {
              order.push('close');
            },
          }),
        },
      },
      async ({ reg }) => {
        mountedCount = reg.mounted.length;
        order.push('body');
      },
    );
    // guard: the server actually mounted, so `close` running proves something real happened
    expect(mountedCount).toBe(1);
    // proves BOTH that close ran and that it ran after the body
    expect(order).toEqual(['body', 'close']);
    await rm(runsRoot, { recursive: true, force: true });
  });

  it('records mcp.transport=stdio on the per-server mount event for a stdio server', async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), 'withmcprun-'));
    const approvalsFile = join(runsRoot, 'approvals.json');
    await withMcpRun(
      {
        runsRoot,
        runId: 'r3',
        config: ONE_SERVER_CONFIG,
        mountDeps: {
          consent: { autoYes: true },
          approvalsFile,
          mount: async () => ({ tools: {}, close: async () => {} }),
        },
      },
      async () => {},
    );
    const lines = (await readFile(join(runsRoot, 'r3', 'spans.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const mountSpan = lines.find((s) => s.name === 'mcp.mount');
    const mountEvent = mountSpan?.events?.find(
      (e: { name: string }) => e.name === 'mcp.server.mount',
    );
    expect(mountEvent?.attributes?.['mcp.transport']).toBe('stdio');
    await rm(runsRoot, { recursive: true, force: true });
  });
});
