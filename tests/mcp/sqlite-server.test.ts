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

    // read-only WITH...SELECT CTEs must be allowed (Slice-15 review finding)
    const cte = (await q.execute(
      { sql: 'WITH x AS (SELECT 1 AS n) SELECT * FROM x' },
      opts,
    )) as { isError?: boolean; content: { text: string }[] };
    expect(cte.isError).not.toBe(true);
    expect(cte.content[0]?.text).toContain('1');

    // a data-modifying CTE must still be rejected, even though it starts
    // with WITH and contains a nested SELECT
    const cteWrite = (await q.execute(
      { sql: 'WITH x AS (SELECT 1) DELETE FROM notes' },
      opts,
    )) as { isError?: boolean; content: { text: string }[] };
    expect(cteWrite.isError).toBe(true);
    const survived = (await q.execute(
      { sql: 'SELECT count(*) AS n FROM notes' },
      opts,
    )) as { content: { text: string }[] };
    expect(survived.content[0]?.text).toContain('1'); // row still survived

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

// Security regression: the read-only gate must be enforced by the SQLite
// engine (PRAGMA query_only), not by a textual classifier. A paren-counting
// or keyword-scanning classifier has no string-literal awareness and can be
// fooled by a crafted string literal that contains SQL-looking punctuation.
test('sqlite MCP server: query tool cannot be bypassed via a string-literal trick', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'mcp-sqlite-sec-')), 't.db');
  const { tools, close } = await mountMcpServer({
    command: 'bun',
    args: ['run', 'src/mcp/sqlite-server.ts', dbPath],
  });
  try {
    const exec = tools.execute as {
      execute: (a: unknown, o: unknown) => Promise<unknown>;
    };
    const query = tools.query as {
      execute: (
        a: unknown,
        o: unknown,
      ) => Promise<{ isError?: boolean; content: { text: string }[] }>;
    };
    const opts = { toolCallId: 't', messages: [] };

    await exec.execute(
      { sql: 'CREATE TABLE t (id INTEGER PRIMARY KEY)' },
      opts,
    );
    await exec.execute({ sql: 'INSERT INTO t VALUES (1)' }, opts);
    await exec.execute({ sql: 'INSERT INTO t VALUES (2)' }, opts);

    const rowCount = async () => {
      const res = await query.execute(
        { sql: 'SELECT count(*) AS n FROM t' },
        opts,
      );
      return JSON.parse(res.content[0]?.text ?? '[]')[0].n as number;
    };

    expect(await rowCount()).toBe(2);

    // The exact bypass payload from the security finding: a string literal
    // containing `)select(` defeats a paren-counting classifier into
    // thinking the DELETE is nested inside the CTE body.
    const bypass = "WITH x AS (SELECT ')select(' AS s) DELETE FROM t";
    const bypassResult = await query.execute({ sql: bypass }, opts);
    expect(bypassResult.isError).toBe(true);
    expect(await rowCount()).toBe(2); // unchanged — DELETE must NOT execute

    // A read-only WITH...SELECT CTE is still allowed.
    const cteSelect = await query.execute(
      { sql: 'WITH x AS (SELECT 1) SELECT * FROM x' },
      opts,
    );
    expect(cteSelect.isError).not.toBe(true);
    expect(cteSelect.content[0]?.text).toContain('1');

    // A plain SELECT is allowed.
    const plainSelect = await query.execute({ sql: 'SELECT * FROM t' }, opts);
    expect(plainSelect.isError).not.toBe(true);

    // Every write shape is rejected by the query tool, and none of them
    // actually mutate the table.
    const writes = [
      'INSERT INTO t VALUES (3)',
      'UPDATE t SET id = 99 WHERE id = 1',
      'DELETE FROM t',
      'DROP TABLE t',
      'WITH x AS (SELECT 1) DELETE FROM t', // plain (non-bypass) WITH...DELETE
    ];
    for (const sql of writes) {
      const res = await query.execute({ sql }, opts);
      expect(res.isError).toBe(true);
    }
    expect(await rowCount()).toBe(2); // still unchanged after all attempts

    // Regression guard: query_only must not leak into the write tool — the
    // execute tool must still be able to write after the query tool ran.
    const writeAfter = (await exec.execute(
      { sql: 'INSERT INTO t VALUES (4)' },
      opts,
    )) as { isError?: boolean; content: { text: string }[] };
    expect(writeAfter.isError).not.toBe(true);
    expect(await rowCount()).toBe(3);
  } finally {
    await close();
  }
});
