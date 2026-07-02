### Task 4: `bun:sqlite` server + starter pack + `bun run mcp` CLI

**Files:**
- Create: `src/mcp/sqlite-server.ts`
- Create: `src/mcp/pack.ts`
- Create: `src/cli/mcp.ts`
- Modify: `package.json` (add `"mcp"` script)
- Test: `tests/mcp/sqlite-server.test.ts`
- Test: `tests/mcp/pack.test.ts`
- Test: `tests/mcp/cli-add.test.ts`

**Interfaces:**
- Consumes: `mountMcpServer` (Task 3); `PackEntry` (Task 1); `loadMcpConfig`/`defaultConfigPath` (Task 1).
- Produces:
  - `src/mcp/sqlite-server.ts` — stdio MCP server, DB path = `process.argv[2] ?? ':memory:'`; tools `query` (SELECT → rows JSON), `execute` (statement → `{changes}`), `schema` (tables + columns).
  - `STARTER_PACK: PackEntry[]` · `getPackEntry(name: string): PackEntry | undefined` · `packByCapability(cap: string): PackEntry[]`
  - `addPackEntry(name: string, configPath?: string): { ok: boolean; message: string }` (exported from `src/cli/mcp.ts` for tests; atomic temp+rename write, creates the file if absent, refuses to overwrite an existing same-name entry).

- [ ] **Step 1: Write the failing sqlite round-trip test (REAL stdio mount)**

```ts
// tests/mcp/sqlite-server.test.ts
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
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test tests/mcp/sqlite-server.test.ts`
Expected: FAIL (server file missing → mount error).

- [ ] **Step 3: Create `src/mcp/sqlite-server.ts`**

```ts
import { Database } from 'bun:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const dbPath = process.argv[2] ?? ':memory:';
const db = new Database(dbPath);

const server = new McpServer({ name: 'sqlite-tools', version: '0.1.0' });

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
}

server.registerTool(
  'query',
  {
    title: 'SQL Query',
    description: `Run a read-only SQL SELECT against the ${dbPath} SQLite database and return rows as JSON.`,
    inputSchema: { sql: z.string() },
  },
  async ({ sql }) => {
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
    description: 'Run a writing SQL statement (CREATE/INSERT/UPDATE/DELETE) and return the change count.',
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
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      const out = tables.map((t) => ({
        table: t.name,
        columns: db.query(`PRAGMA table_info(${JSON.stringify(t.name)})`).all(),
      }));
      return textResult(JSON.stringify(out, null, 2));
    } catch (cause) {
      return textResult(`schema failed: ${(cause as Error).message}`, true);
    }
  },
);

await server.connect(new StdioServerTransport());
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/mcp/sqlite-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing pack + CLI-add tests**

```ts
// tests/mcp/pack.test.ts
import { describe, expect, it } from 'bun:test';
import { STARTER_PACK, getPackEntry, packByCapability } from '../../src/mcp/pack.ts';

describe('starter pack', () => {
  it('has the 12 curated entries with unique names', () => {
    expect(STARTER_PACK).toHaveLength(12);
    expect(new Set(STARTER_PACK.map((e) => e.name)).size).toBe(12);
  });
  it('every entry has a description and ≥1 capability', () => {
    for (const e of STARTER_PACK) {
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.capabilities.length).toBeGreaterThan(0);
    }
  });
  it('is queryable by capability (the agent-builder palette)', () => {
    expect(packByCapability('web-search').map((e) => e.name)).toEqual(['brave-search', 'exa-search']);
    expect(packByCapability('sql')[0]?.name).toBe('sqlite');
  });
  it('keyed entries declare requiresEnv and reference ${VAR} in the server value', () => {
    const gh = getPackEntry('github');
    expect(gh?.requiresEnv).toEqual(['GITHUB_PAT']);
    expect(JSON.stringify(gh?.server)).toContain('${GITHUB_PAT}');
  });
  it('never emits archived @modelcontextprotocol invocations (2025 prune)', () => {
    const all = JSON.stringify(STARTER_PACK);
    for (const dead of ['server-postgres', 'server-sqlite', 'server-brave-search', 'server-puppeteer', 'server-github']) {
      expect(all).not.toContain(dead);
    }
  });
});
```

```ts
// tests/mcp/cli-add.test.ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPackEntry } from '../../src/cli/mcp.ts';

const tmpConfig = () => join(mkdtempSync(join(tmpdir(), 'mcp-add-')), 'mcp.json');

describe('addPackEntry', () => {
  it('creates mcp.json with the pack entry when absent', () => {
    const path = tmpConfig();
    const r = addPackEntry('git', path);
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers.git.command).toBe('uvx');
  });
  it('appends into an existing mcp.json without disturbing other entries', () => {
    const path = tmpConfig();
    writeFileSync(path, JSON.stringify({ mcpServers: { keep: { command: 'bun' } } }));
    addPackEntry('time', path);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers.keep.command).toBe('bun');
    expect(parsed.mcpServers.time.command).toBe('uvx');
  });
  it('refuses to overwrite an existing entry of the same name', () => {
    const path = tmpConfig();
    writeFileSync(path, JSON.stringify({ mcpServers: { git: { command: 'custom' } } }));
    const r = addPackEntry('git', path);
    expect(r.ok).toBe(false);
    expect(JSON.parse(readFileSync(path, 'utf8')).mcpServers.git.command).toBe('custom');
  });
  it('reports unknown pack names', () => {
    expect(addPackEntry('nonsense', tmpConfig()).ok).toBe(false);
  });
});
```

- [ ] **Step 6: Run to verify fail; create `src/mcp/pack.ts`**

Run: `bun test tests/mcp/pack.test.ts tests/mcp/cli-add.test.ts` — Expected: FAIL.

```ts
// src/mcp/pack.ts
import type { PackEntry } from './types.ts';

/** The curated starter pack (2026-07 verified: only maintained servers; the
 *  official sqlite/postgres/brave/puppeteer/github packages were archived in
 *  2025 and must not be emitted). This is the palette the agent-builder
 *  (Phase D) suggests from — keep capabilities accurate. */
export const STARTER_PACK: PackEntry[] = [
  {
    name: 'file-tools',
    description: 'In-repo read_file server (this framework).',
    capabilities: ['files'],
    server: { command: 'bun', args: ['run', 'src/mcp/server.ts'], agents: ['file_qa'] },
  },
  {
    name: 'sqlite',
    description: 'In-repo SQLite server on bun:sqlite (query/execute/schema).',
    capabilities: ['sql'],
    server: { command: 'bun', args: ['run', 'src/mcp/sqlite-server.ts', 'data/agent.db'] },
  },
  {
    name: 'filesystem',
    description: 'Official filesystem server (scoped to listed directories).',
    capabilities: ['files'],
    server: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
  },
  {
    name: 'memory',
    description: 'Official knowledge-graph memory server.',
    capabilities: ['memory'],
    server: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  },
  {
    name: 'sequential-thinking',
    description: 'Official structured step-by-step reasoning server.',
    capabilities: ['reasoning'],
    server: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
  },
  {
    name: 'fetch',
    description: 'Official web-fetch server (keyless; requires uvx).',
    capabilities: ['http'],
    server: { command: 'uvx', args: ['mcp-server-fetch'], agents: ['web_fetch'] },
  },
  {
    name: 'git',
    description: 'Official git server (log/diff/status on local repos).',
    capabilities: ['vcs'],
    server: { command: 'uvx', args: ['mcp-server-git'] },
  },
  {
    name: 'time',
    description: 'Official time/timezone server.',
    capabilities: ['time'],
    server: { command: 'uvx', args: ['mcp-server-time'] },
  },
  {
    name: 'playwright',
    description: 'Microsoft Playwright browser automation (downloads browsers on first run).',
    capabilities: ['browser'],
    server: { command: 'npx', args: ['@playwright/mcp@latest'] },
  },
  {
    name: 'github',
    description: "GitHub's official remote server (Streamable HTTP; needs a PAT).",
    capabilities: ['vcs'],
    requiresEnv: ['GITHUB_PAT'],
    server: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ${GITHUB_PAT}' },
    },
  },
  {
    name: 'brave-search',
    description: "Brave's official web-search server (needs BRAVE_API_KEY).",
    capabilities: ['web-search'],
    requiresEnv: ['BRAVE_API_KEY'],
    server: {
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server'],
      env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' },
    },
  },
  {
    name: 'exa-search',
    description: 'Exa semantic web-search server (needs EXA_API_KEY).',
    capabilities: ['web-search'],
    requiresEnv: ['EXA_API_KEY'],
    server: {
      command: 'npx',
      args: ['-y', 'exa-mcp-server'],
      env: { EXA_API_KEY: '${EXA_API_KEY}' },
    },
  },
];

export function getPackEntry(name: string): PackEntry | undefined {
  return STARTER_PACK.find((e) => e.name === name);
}

export function packByCapability(cap: string): PackEntry[] {
  return STARTER_PACK.filter((e) => e.capabilities.includes(cap));
}
```

- [ ] **Step 7: Create `src/cli/mcp.ts`**

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { defaultConfigPath, loadMcpConfig } from '../mcp/config.ts';
import { STARTER_PACK, getPackEntry } from '../mcp/pack.ts';

/** Copy a starter-pack entry into mcp.json (atomic write; never overwrites). */
export function addPackEntry(
  name: string,
  configPath: string = defaultConfigPath(),
): { ok: boolean; message: string } {
  const pack = getPackEntry(name);
  if (!pack) {
    return { ok: false, message: `unknown pack entry "${name}" — run \`bun run mcp list\`` };
  }
  let root: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(configPath)) {
    try {
      root = JSON.parse(readFileSync(configPath, 'utf8')) as typeof root;
    } catch (cause) {
      return { ok: false, message: `mcp.json is not valid JSON: ${(cause as Error).message}` };
    }
  }
  const servers = root.mcpServers ?? {};
  if (servers[name]) {
    return { ok: false, message: `"${name}" already exists in ${configPath} — edit it directly` };
  }
  servers[name] = pack.server;
  const tmp = `${configPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...root, mcpServers: servers }, null, 2)}\n`);
  renameSync(tmp, configPath);
  const keyNote = pack.requiresEnv?.length
    ? ` (dormant until ${pack.requiresEnv.join(', ')} is set)`
    : '';
  return { ok: true, message: `added "${name}" to ${configPath}${keyNote}` };
}

function list(): void {
  const cfg = loadMcpConfig();
  const inConfig = new Set([
    ...cfg.entries.map((e) => e.name),
    ...cfg.dormant.map((d) => d.name),
  ]);
  console.log('Starter pack (bun run mcp add <name>):\n');
  for (const e of STARTER_PACK) {
    const state = inConfig.has(e.name) ? '✓ in mcp.json' : ' ';
    const key = e.requiresEnv?.length ? ` 🔑 ${e.requiresEnv.join(',')}` : '';
    console.log(`  [${state}] ${e.name}  (${e.capabilities.join(', ')})${key}\n        ${e.description}`);
  }
}

function status(): void {
  const cfg = loadMcpConfig();
  for (const w of cfg.warnings) console.error(`⚠ ${w}`);
  console.log(`Configured servers (${defaultConfigPath()}):\n`);
  for (const e of cfg.entries) {
    const scope = e.agents ? `agents: ${e.agents.join(', ')}` : 'agents: all';
    console.log(`  active   ${e.name}  (${e.kind}; ${scope})`);
  }
  for (const d of cfg.dormant) {
    console.log(`  dormant  ${d.name}  (set ${d.missingVars.join(', ')})`);
  }
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'list') return list();
  if (cmd === 'status') return status();
  if (cmd === 'add' && arg) {
    const r = addPackEntry(arg);
    (r.ok ? console.log : console.error)(r.message);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  console.error('Usage: bun run mcp <list|status|add <name>>');
  process.exitCode = 1;
}

if (import.meta.main) main();
```

- [ ] **Step 8: Add the script to `package.json`**

In the `scripts` block, after `"provision"`:

```json
    "provision": "bun run src/cli/provision.ts",
    "mcp": "bun run src/cli/mcp.ts"
```

- [ ] **Step 9: Run to verify pass**

Run: `bun test tests/mcp/pack.test.ts tests/mcp/cli-add.test.ts tests/mcp/sqlite-server.test.ts`
Expected: PASS (all). Also smoke: `bun run mcp list` prints the 12 entries.

- [ ] **Step 10: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint:file -- "src/mcp/sqlite-server.ts" "src/mcp/pack.ts" "src/cli/mcp.ts"`
Expected: clean.

```bash
git add src/mcp/sqlite-server.ts src/mcp/pack.ts src/cli/mcp.ts package.json tests/mcp/sqlite-server.test.ts tests/mcp/pack.test.ts tests/mcp/cli-add.test.ts
git commit -m "feat(mcp): bun:sqlite server + capability-tagged starter pack + bun run mcp CLI (Slice 15 Task 4)"
```

---

