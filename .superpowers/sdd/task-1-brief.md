### Task 1: Types + `mcp.json` config loader

**Files:**
- Create: `src/mcp/types.ts`
- Create: `src/mcp/config.ts`
- Test: `tests/mcp/config.test.ts`

**Interfaces:**
- Consumes: nothing new (zod, node:fs).
- Produces:
  - `enum McpTransportKind { Stdio = 'stdio', Http = 'http' }`
  - `type McpServerEntry = { kind: McpTransportKind.Stdio; name: string; command: string; args: string[]; env: Record<string, string>; agents?: string[]; raw: unknown } | { kind: McpTransportKind.Http; name: string; url: string; headers: Record<string, string>; agents?: string[]; raw: unknown }`
  - `type McpConfig = { entries: McpServerEntry[]; dormant: { name: string; missingVars: string[] }[]; warnings: string[] }`
  - `expandVars(value: string, env?: Record<string, string | undefined>): { value: string; missing: string[] }`
  - `loadMcpConfig(path?: string, env?: Record<string, string | undefined>): McpConfig` (default path: `process.env.AGENT_MCP_CONFIG ?? join(process.cwd(), 'mcp.json')`)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mcp/config.test.ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandVars, loadMcpConfig } from '../../src/mcp/config.ts';
import { McpTransportKind } from '../../src/mcp/types.ts';

function writeConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-config-'));
  const path = join(dir, 'mcp.json');
  writeFileSync(path, typeof json === 'string' ? json : JSON.stringify(json));
  return path;
}

describe('expandVars', () => {
  it('expands ${VAR} from env', () => {
    expect(expandVars('Bearer ${TOK}', { TOK: 'abc' })).toEqual({ value: 'Bearer abc', missing: [] });
  });
  it('uses ${VAR:-default} when unset', () => {
    expect(expandVars('${HOST:-localhost}', {})).toEqual({ value: 'localhost', missing: [] });
  });
  it('reports missing vars without a default', () => {
    expect(expandVars('${NOPE}', {}).missing).toEqual(['NOPE']);
  });
});

describe('loadMcpConfig', () => {
  it('parses stdio and http entries with agents', () => {
    const path = writeConfig({
      mcpServers: {
        ft: { command: 'bun', args: ['run', 's.ts'], agents: ['file_qa'] },
        gh: { type: 'http', url: 'https://x.test/mcp', headers: { Authorization: 'Bearer ${T}' } },
      },
    });
    const cfg = loadMcpConfig(path, { T: 'tok' });
    expect(cfg.entries).toHaveLength(2);
    const [ft, gh] = cfg.entries;
    expect(ft?.kind).toBe(McpTransportKind.Stdio);
    expect(ft?.agents).toEqual(['file_qa']);
    if (gh?.kind === McpTransportKind.Http) expect(gh.headers.Authorization).toBe('Bearer tok');
  });
  it('marks entries with unset env vars dormant, not failed', () => {
    const path = writeConfig({
      mcpServers: { gh: { type: 'http', url: 'https://x.test', headers: { A: '${MISSING_KEY}' } } },
    });
    const cfg = loadMcpConfig(path, {});
    expect(cfg.entries).toHaveLength(0);
    expect(cfg.dormant).toEqual([{ name: 'gh', missingVars: ['MISSING_KEY'] }]);
  });
  it('skips a malformed entry with a warning but keeps valid ones', () => {
    const path = writeConfig({
      mcpServers: { bad: { args: ['no-command'] }, ok: { command: 'bun' } },
    });
    const cfg = loadMcpConfig(path, {});
    expect(cfg.entries.map((e) => e.name)).toEqual(['ok']);
    expect(cfg.warnings.some((w) => w.includes('bad'))).toBe(true);
  });
  it('tolerates a VS-Code-style "servers" root with a notice', () => {
    const path = writeConfig({ servers: { ok: { command: 'bun' } } });
    const cfg = loadMcpConfig(path, {});
    expect(cfg.entries).toHaveLength(1);
    expect(cfg.warnings.some((w) => w.includes('servers'))).toBe(true);
  });
  it('degrades on missing file and corrupt JSON (warn, empty, never throw)', () => {
    expect(loadMcpConfig('/nope/mcp.json', {}).entries).toEqual([]);
    const corrupt = writeConfig('{not json');
    expect(loadMcpConfig(corrupt, {}).warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test tests/mcp/config.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Create `src/mcp/types.ts`**

```ts
import { z } from 'zod';

export enum McpTransportKind {
  Stdio = 'stdio',
  Http = 'http',
}

/** Raw per-entry schemas — the standard mcpServers shape + our `agents` extension. */
export const stdioEntrySchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  agents: z.array(z.string()).optional(),
});

export const httpEntrySchema = z.object({
  type: z.enum(['http', 'streamable-http', 'sse']), // aliases tolerated; all mount as HTTP
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  agents: z.array(z.string()).optional(),
});

export const serverEntrySchema = z.union([httpEntrySchema, stdioEntrySchema]);

/** A validated, env-expanded server entry ready to mount. `raw` keeps the
 *  as-written config value for consent display + spec hashing (never expanded). */
export type StdioServerEntry = {
  kind: McpTransportKind.Stdio;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  agents?: string[];
  raw: unknown;
};

export type HttpServerEntry = {
  kind: McpTransportKind.Http;
  name: string;
  url: string;
  headers: Record<string, string>;
  agents?: string[];
  raw: unknown;
};

export type McpServerEntry = StdioServerEntry | HttpServerEntry;

export type McpConfig = {
  entries: McpServerEntry[];
  dormant: { name: string; missingVars: string[] }[];
  warnings: string[];
};

/** A curated starter-pack entry: the raw server value plus builder-queryable metadata. */
export type PackEntry = {
  name: string;
  description: string;
  capabilities: string[];
  requiresEnv?: string[];
  /** The value to write under mcpServers.<name> in mcp.json (raw, unexpanded). */
  server: Record<string, unknown>;
};
```

- [ ] **Step 4: Create `src/mcp/config.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type McpConfig,
  type McpServerEntry,
  McpTransportKind,
  serverEntrySchema,
} from './types.ts';

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/** Expand ${VAR} / ${VAR:-default}; report vars that are unset with no default. */
export function expandVars(
  value: string,
  env: Record<string, string | undefined> = process.env,
): { value: string; missing: string[] } {
  const missing: string[] = [];
  const out = value.replace(VAR_PATTERN, (_m, name: string, def?: string) => {
    const v = env[name];
    if (v !== undefined) return v;
    if (def !== undefined) return def;
    missing.push(name);
    return '';
  });
  return { value: out, missing };
}

function expandRecord(
  rec: Record<string, string>,
  env: Record<string, string | undefined>,
  missing: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    const e = expandVars(v, env);
    missing.push(...e.missing);
    out[k] = e.value;
  }
  return out;
}

export function defaultConfigPath(): string {
  return process.env.AGENT_MCP_CONFIG ?? join(process.cwd(), 'mcp.json');
}

/** Load + validate mcp.json. Per-entry degrade: a bad entry warns and is
 *  skipped; entries with unset env vars are dormant; never throws. */
export function loadMcpConfig(
  path: string = defaultConfigPath(),
  env: Record<string, string | undefined> = process.env,
): McpConfig {
  const cfg: McpConfig = { entries: [], dormant: [], warnings: [] };
  if (!existsSync(path)) {
    cfg.warnings.push(`mcp.json not found at ${path} — no MCP servers mounted`);
    return cfg;
  }
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (cause) {
    cfg.warnings.push(`mcp.json at ${path} is not valid JSON (${(cause as Error).message})`);
    return cfg;
  }
  let servers = root.mcpServers as Record<string, unknown> | undefined;
  if (!servers && root.servers) {
    servers = root.servers as Record<string, unknown>;
    cfg.warnings.push('mcp.json uses a VS-Code-style "servers" root; reading it as mcpServers');
  }
  if (!servers || typeof servers !== 'object') {
    cfg.warnings.push('mcp.json has no mcpServers object — nothing to mount');
    return cfg;
  }
  for (const [name, raw] of Object.entries(servers)) {
    const parsed = serverEntrySchema.safeParse(raw);
    if (!parsed.success) {
      cfg.warnings.push(`mcp.json entry "${name}" is invalid and was skipped: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
      continue;
    }
    const missing: string[] = [];
    const entry = toEntry(name, parsed.data, raw, env, missing);
    if (missing.length > 0) {
      cfg.dormant.push({ name, missingVars: [...new Set(missing)] });
      continue;
    }
    cfg.entries.push(entry);
  }
  return cfg;
}

function toEntry(
  name: string,
  data: import('zod').infer<typeof serverEntrySchema>,
  raw: unknown,
  env: Record<string, string | undefined>,
  missing: string[],
): McpServerEntry {
  if ('url' in data) {
    const url = expandVars(data.url, env);
    missing.push(...url.missing);
    return {
      kind: McpTransportKind.Http,
      name,
      url: url.value,
      headers: expandRecord(data.headers ?? {}, env, missing),
      agents: data.agents,
      raw,
    };
  }
  const command = expandVars(data.command, env);
  missing.push(...command.missing);
  const args = (data.args ?? []).map((a) => {
    const e = expandVars(a, env);
    missing.push(...e.missing);
    return e.value;
  });
  return {
    kind: McpTransportKind.Stdio,
    name,
    command: command.value,
    args,
    env: expandRecord(data.env ?? {}, env, missing),
    agents: data.agents,
    raw,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test tests/mcp/config.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint:file -- "src/mcp/types.ts" "src/mcp/config.ts" "tests/mcp/config.test.ts"`
Expected: clean.

```bash
git add src/mcp/types.ts src/mcp/config.ts tests/mcp/config.test.ts
git commit -m "feat(mcp): mcp.json types + validated loader with env expansion and per-entry degrade (Slice 15 Task 1)"
```

---

