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

server.registerTool(
  'query',
  {
    title: 'SQL Query',
    description: `Run a SQL SELECT against the ${dbPath} SQLite database and return rows as JSON. Only SELECT statements are accepted; use execute for writes.`,
    inputSchema: { sql: z.string() },
  },
  async ({ sql }) => {
    const trimmed = sql.trim();
    if (!/^select\b/i.test(trimmed)) {
      return textResult(
        'query only accepts SELECT statements; use the execute tool for writes',
        true,
      );
    }
    try {
      const rows = db.query(sql).all();
      return textResult(JSON.stringify(rows, null, 2));
    } catch (cause) {
      return textResult(`query failed: ${(cause as Error).message}`, true);
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
