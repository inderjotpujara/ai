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
    const exec = tools.execute as {
      execute: (a: unknown, o: unknown) => Promise<unknown>;
    };
    const opts = { toolCallId: 't', messages: [] };
    await exec.execute(
      { sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)' },
      opts,
    );
    await exec.execute(
      { sql: "INSERT INTO notes (body) VALUES ('hello')" },
      opts,
    );
    const q = tools.query as {
      execute: (a: unknown, o: unknown) => Promise<unknown>;
    };
    const res = (await q.execute({ sql: 'SELECT body FROM notes' }, opts)) as {
      content: { type: string; text: string }[];
    };
    expect(res.content[0]?.text).toContain('hello');

    // query must reject writes (read-only enforcement)
    const rejected = (await q.execute({ sql: 'DELETE FROM notes' }, opts)) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(rejected.isError).toBe(true);
    const still = (await q.execute(
      { sql: 'SELECT count(*) AS n FROM notes' },
      opts,
    )) as {
      content: { text: string }[];
    };
    expect(still.content[0]?.text).toContain('1'); // row survived

    // schema handles legal table names containing a double quote
    await exec.execute(
      { sql: 'CREATE TABLE "weird""name" (id INTEGER)' },
      opts,
    );
    const sch = tools.schema as {
      execute: (a: unknown, o: unknown) => Promise<unknown>;
    };
    const schemaRes = (await sch.execute({}, opts)) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(schemaRes.isError).not.toBe(true);
    // Verify the table with embedded quote was successfully introspected
    expect(schemaRes.content[0]?.text).toContain('weird');
    expect(schemaRes.content[0]?.text).toContain('name');

    // invalid SQL surfaces as isError result, not a throw
    const bad = (await exec.execute({ sql: 'NOT REAL SQL' }, opts)) as {
      isError?: boolean;
    };
    expect(bad.isError).toBe(true);
  } finally {
    await close();
  }
});

// Regression: bun:sqlite doesn't create parent directories for a file path;
// a bare clone's first mount of the `sqlite` pack entry (default
// `data/agent.db`) previously failed for this reason. The server must
// mkdir -p the db's directory before opening it.
test('sqlite MCP server: mounts when the db path is in a non-existent nested dir', async () => {
  const nestedDb = join(
    mkdtempSync(join(tmpdir(), 'mcp-sqlite-nested-')),
    'nested/deeper/t.db',
  );
  const { tools, close } = await mountMcpServer({
    command: 'bun',
    args: ['run', 'src/mcp/sqlite-server.ts', nestedDb],
  });
  try {
    expect(tools.query).toBeDefined();
    expect(tools.execute).toBeDefined();
    expect(tools.schema).toBeDefined();
  } finally {
    await close();
  }
});
