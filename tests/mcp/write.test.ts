import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeMcpEntry } from '../../src/mcp/write.ts';

test('writes a new entry atomically and rejects a duplicate name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-write-'));
  const path = join(dir, 'mcp.json');

  const first = await writeMcpEntry(
    'gh',
    { command: 'bun', args: ['run', 's.ts'] },
    path,
  );
  expect(first.ok).toBe(true);
  expect(existsSync(path)).toBe(true);
  const written = JSON.parse(readFileSync(path, 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  expect(written.mcpServers.gh).toEqual({
    command: 'bun',
    args: ['run', 's.ts'],
  });

  const dup = await writeMcpEntry('gh', { command: 'bun' }, path);
  expect(dup.ok).toBe(false);
  expect(dup.message).toContain('already exists');
});

test('concurrent adds to the same file are serialized (no lost update)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-write-'));
  const path = join(dir, 'mcp.json');
  const [a, b] = await Promise.all([
    writeMcpEntry('a', { command: 'bun' }, path),
    writeMcpEntry('b', { command: 'bun' }, path),
  ]);
  expect(a.ok && b.ok).toBe(true);
  const written = JSON.parse(readFileSync(path, 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  expect(Object.keys(written.mcpServers).sort()).toEqual(['a', 'b']);
});
