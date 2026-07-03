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

// Collapse every balanced `(...)` group to a single space, dropping its
// contents. Used to see past CTE bodies / column lists so the read-only gate
// can find a WITH-prefixed query's real leading statement keyword without
// parsing full SQL grammar.
function stripParenGroups(sql: string): string {
  let depth = 0;
  let out = '';
  for (const ch of sql) {
    if (ch === '(') {
      depth++;
      if (depth === 1) out += ' ';
      continue;
    }
    if (ch === ')') {
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

// A query is read-only if it is a bare SELECT, or a WITH-prefixed query whose
// main statement (after the CTE definitions) is a SELECT. A CTE can legally
// wrap a data-modifying main statement (`WITH x AS (...) DELETE ...`), so the
// WITH case must resolve past every `name [(cols)] AS (body)` CTE definition
// to find the real leading keyword — degrade to "reject" on anything that
// doesn't match the expected shape.
function isReadOnlyQuery(sql: string): boolean {
  if (/^select\b/i.test(sql)) return true;
  if (!/^with\b/i.test(sql)) return false;

  const tokens = stripParenGroups(sql)
    .replace(/,/g, ' , ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  let i = 0;
  if (tokens[i] !== 'with') return false;
  i++;
  if (tokens[i] === 'recursive') i++;

  for (;;) {
    const name = tokens[i];
    if (!name || name === ',') return false; // malformed CTE header
    i++;
    if (tokens[i] !== 'as') return false; // CTEs require AS in SQLite
    i++;
    if (tokens[i] === ',') {
      i++;
      continue;
    }
    break;
  }

  return tokens[i] === 'select';
}

server.registerTool(
  'query',
  {
    title: 'SQL Query',
    description: `Run a SQL SELECT (including a read-only WITH...SELECT CTE) against the ${dbPath} SQLite database and return rows as JSON. Data-modifying statements are rejected; use execute for writes.`,
    inputSchema: { sql: z.string() },
  },
  async ({ sql }) => {
    const trimmed = sql.trim();
    if (!isReadOnlyQuery(trimmed)) {
      return textResult(
        'query only accepts read-only SELECT (or WITH...SELECT) statements; use the execute tool for writes',
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
