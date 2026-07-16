import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type McpServerDTO,
  McpServerStatus,
} from '../../src/contracts/index.ts';
import { handleMcpList } from '../../src/server/mcp/list.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';

function writeConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-list-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify(json));
  return path;
}

test('GET /api/mcp joins entries + dormant with the mount-status snapshot', async () => {
  const path = writeConfig({
    mcpServers: {
      active: { command: 'bun', args: ['run', 's.ts'] },
      dormant_one: {
        type: 'http',
        url: 'https://x.test',
        headers: { A: '${MISSING}' },
      },
    },
  });
  const status = createMcpMountStatus();
  status.record('active', 'mounted');

  const res = handleMcpList({ mcpConfigPath: path, mcpMountStatus: status });
  expect(res.status).toBe(200);
  expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');

  const body = (await res.json()) as { items: McpServerDTO[] };
  expect(body.items.find((s) => s.name === 'active')?.status).toBe(
    McpServerStatus.Mounted,
  );
  expect(body.items.find((s) => s.name === 'dormant_one')?.status).toBe(
    McpServerStatus.Dormant,
  );
});

test('GET /api/mcp reports a never-mounted active server as skipped with a "use Test Mount" reason', async () => {
  const path = writeConfig({
    mcpServers: {
      untouched: { command: 'bun', args: ['run', 's.ts'] },
    },
  });
  const status = createMcpMountStatus();

  const res = handleMcpList({ mcpConfigPath: path, mcpMountStatus: status });
  const body = (await res.json()) as { items: McpServerDTO[] };
  const entry = body.items.find((s) => s.name === 'untouched');
  expect(entry?.status).toBe(McpServerStatus.Skipped);
  expect(entry?.reason).toBe('not mounted this session — use Test Mount');
});
