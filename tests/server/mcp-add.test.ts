import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMcpAdd } from '../../src/server/mcp/add.ts';
import { createMcpMountStatus } from '../../src/server/mcp/mount-status.ts';

function addReq(body: unknown): Request {
  return new Request('http://localhost/api/mcp/add', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('adds a new stdio server and returns its projected DTO', async () => {
  const mcpConfigPath = join(
    mkdtempSync(join(tmpdir(), 'mcp-add-')),
    'mcp.json',
  );
  const res = await handleMcpAdd(
    addReq({ name: 'gh', server: { command: 'bun', args: ['run', 's.ts'] } }),
    { mcpConfigPath, mcpMountStatus: createMcpMountStatus() },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { name: string; status: string };
  expect(body.name).toBe('gh');
  expect(body.status).toBe('skipped'); // never mounted yet this session
});

test('a dormant add (missing env var) reports status "dormant"', async () => {
  const mcpConfigPath = join(
    mkdtempSync(join(tmpdir(), 'mcp-add-')),
    'mcp.json',
  );
  const res = await handleMcpAdd(
    addReq({
      name: 'gh',
      server: {
        type: 'http',
        url: 'https://x.test',
        headers: { A: '${GH_TOKEN}' },
      },
    }),
    { mcpConfigPath, mcpMountStatus: createMcpMountStatus() },
  );
  const body = (await res.json()) as { status: string };
  expect(body.status).toBe('dormant');
});

test('duplicate name → 409', async () => {
  const mcpConfigPath = join(
    mkdtempSync(join(tmpdir(), 'mcp-add-')),
    'mcp.json',
  );
  const deps = { mcpConfigPath, mcpMountStatus: createMcpMountStatus() };
  await handleMcpAdd(addReq({ name: 'gh', server: { command: 'bun' } }), deps);
  const res = await handleMcpAdd(
    addReq({ name: 'gh', server: { command: 'bun' } }),
    deps,
  );
  expect(res.status).toBe(409);
});

test('malformed body → 400', async () => {
  const res = await handleMcpAdd(addReq({ nope: true }), {
    mcpConfigPath: '/tmp/never-read-mcp.json',
    mcpMountStatus: createMcpMountStatus(),
  });
  expect(res.status).toBe(400);
});
