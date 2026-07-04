import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const dbPath = process.argv[2] ?? ':memory:';
// bun:sqlite does not create parent directories for a file path; a bare
// clone's first mount of the `sqlite` pack entry (default `data/agent.db`)
// would otherwise fail. `:memory:` has no directory to create.
if (dbPath !== ':memory:') {
  mkdirSync(dirname(dbPath), { recursive: true });
}
const db = new Database(dbPath);

const server = new McpServer({ name: 'sqlite-tools', version: '0.1.0' });

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

// The `query` tool's read-only guarantee is enforced by the SQLite engine
// itself (`PRAGMA query_only = ON`), not by textually classifying the SQL
// string. A home-rolled classifier that counts `(`/`)` or scans keywords has
// no string-literal awareness and is bypassable — e.g.
// `WITH x AS (SELECT ')select(' AS s) DELETE FROM t` fools a paren-counting
// scanner into treating the DELETE as buried inside a CTE body. With
// `query_only = ON`, SQLite rejects every write (INSERT/UPDATE/DELETE/DROP/
// data-modifying CTEs, …) with a real engine error while `SELECT` and
// `WITH…SELECT` continue to run — the engine is the parser, so no
// string-literal or nesting trick can confuse it. The pragma is toggled OFF
// again in a `finally` so it can never leak into the `execute` (write) tool.
function runReadOnly<T>(fn: () => T): T {
  db.exec('PRAGMA query_only = ON');
  try {
    return fn();
  } finally {
    db.exec('PRAGMA query_only = OFF');
  }
}

server.registerTool(
  'query',
  {
    title: 'SQL Query',
    description: `Run a SQL SELECT (including a read-only WITH...SELECT CTE) against the ${dbPath} SQLite database and return rows as JSON. Data-modifying statements are rejected; use execute for writes.`,
    inputSchema: { sql: z.string() },
  },
  async ({ sql }) => {
    try {
      const rows = runReadOnly(() => db.query(sql).all());
      return textResult(JSON.stringify(rows, null, 2));
    } catch (cause) {
      const message = (cause as Error).message;
      // SQLite's own error for a write attempted under `query_only = ON`;
      // surface it as the read-only-gate rejection rather than a generic
      // query failure.
      if (/readonly database/i.test(message)) {
        return textResult(
          `query only accepts read-only SELECT (or WITH...SELECT) statements; use the execute tool for writes (${message})`,
          true,
        );
      }
      return textResult(`query failed: ${message}`, true);
    }
  },
);

server.registerTool(
  'execute',
  {
    title: 'SQL Execute',
    description:
      'Run a writing SQL statement (CREATE/INSERT/UPDATE/DELETE) and return the change count.',
    inputSchema: { sql: z.string() },
  },
  async ({ sql }) => {
    try {
      // Defense in depth: the `query` tool always resets `query_only` in its
      // own `finally`, but guarantee writes never run under it regardless.
      db.exec('PRAGMA query_only = OFF');
      const r = db.run(sql);
      return textResult(JSON.stringify({ changes: r.changes }));
    } catch (cause) {
      return textResult(`execute failed: ${(cause as Error).message}`, true);
    }
  },
);

server.registerTool(
  'schema',
  {
    title: 'DB Schema',
    description: 'List all tables and their columns in the database.',
    inputSchema: {},
  },
  async () => {
    try {
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as { name: string }[];
      const out = tables.map((t) => ({
        table: t.name,
        columns: db
          .query(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`)
          .all(),
      }));
      return textResult(JSON.stringify(out, null, 2));
    } catch (cause) {
      return textResult(`schema failed: ${(cause as Error).message}`, true);
    }
  },
);

await server.connect(new StdioServerTransport());
