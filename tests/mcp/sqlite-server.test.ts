import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountMcpServer } from '../../src/mcp/client.ts';

// Real subprocess round-trip against our own bun:sqlite server. No network.
test('sqlite MCP server: schema/execute/query round-trip', async () => {
  const db = join(mkdtempSync(join(tmpdir(), 'mcp-sqlite-')), 't.db');
  const { tools, close } = await mountMcpServer({
    command: 'bun',
    args: ['run', 'src/mcp/sqlite-server.ts', db],
  });
  try {
    expect(tools.query).toBeDefined();
    expect(tools.execute).toBeDefined();
    expect(tools.schema).toBeDefined();
    const exec = tools.execute as { execute: (a: unknown, o: unknown) => Promise<unknown> };
    const opts = { toolCallId: 't', messages: [] };
    await exec.execute({ sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)' }, opts);
    await exec.execute({ sql: "INSERT INTO notes (body) VALUES ('hello')" }, opts);
    const q = tools.query as { execute: (a: unknown, o: unknown) => Promise<unknown> };
    const res = (await q.execute({ sql: 'SELECT body FROM notes' }, opts)) as {
      content: { type: string; text: string }[];
    };
    expect(res.content[0]?.text).toContain('hello');
  } finally {
    await close();
  }
});
