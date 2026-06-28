import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileTools } from '../../src/mcp/client.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcp-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('MCP server exposes read_file and reads a file end-to-end', async () => {
  const p = join(dir, 'doc.txt');
  await writeFile(p, 'mcp says hi');

  const { tools, close } = await createFileTools();
  try {
    expect(tools.read_file).toBeDefined();
    const readFileTool = tools.read_file;
    if (!readFileTool) throw new Error('read_file tool not found');
    const result = await readFileTool.execute?.({ path: p }, {} as never);
    const text = JSON.stringify(result);
    expect(text).toContain('mcp says hi');
  } finally {
    await close();
  }
}, 30000);
