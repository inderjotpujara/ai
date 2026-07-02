# Slice 15 — `mcp.json` mount registry + starter pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded MCP mounts in `chat`/`flow`/`crew` with a declarative `mcp.json` registry (servers + which agents get them, loaded at startup, consent-gated with tool-definition pinning), plus a capability-tagged starter pack with a `bun run mcp` CLI — the palette the Phase-D agent-builder will suggest from.

**Architecture:** Everything lives in the existing `src/mcp/` subsystem. `config.ts` loads/validates `mcp.json` (zod, per-entry degrade, `${VAR}` expansion, dormant-until-key). `consent.ts` persists approvals keyed by spec hash + pins tool-definition hashes (rug-pull re-prompt). `mount.ts` mounts approved entries (stdio + Streamable HTTP) and resolves the per-agent attach map. `pack.ts` is the committed capability-tagged catalog; `src/cli/mcp.ts` lists/adds pack entries. A new `withToolSpan` closes the uninstrumented `StepKind.Tool` gap.

**Tech Stack:** TypeScript on Bun; `bun test`; `@ai-sdk/mcp` (`createMCPClient`, already a dep), `@modelcontextprotocol/sdk` (test servers, already a dep), `zod` v4, `node:crypto` (SHA256), `bun:sqlite`. **No new npm dependencies.**

## Global Constraints

- **Runtime/tooling:** always `bun`, never `npm`. `bun run typecheck` must pass; `bun run lint` (biome) clean; no `console.log` left in `src/` (CLI entry files may print results; library code uses `console.warn`/`console.error` or injected loggers).
- **No new npm dependency** (Slice-13/14 precedent). MCP client via `@ai-sdk/mcp`; test servers via `@modelcontextprotocol/sdk`; SQL via `bun:sqlite`; hashing via `node:crypto`.
- **Code style:** `type` over `interface`; **string `enum` for finite named sets** (`enum Foo { A = 'A' }`); discriminated unions stay `type`; early returns; small focused files; descriptive names.
- **No hardcoding** — config path/approvals path are parameters with cwd defaults; env vars (`AGENT_MCP_CONFIG`, `AGENT_MCP_AUTO_APPROVE`) are fallback-only overrides.
- **Consent before mount** — never spawn/connect a server without a recorded approval; non-interactive consent only via `AGENT_MCP_AUTO_APPROVE=1`. Non-TTY + unapproved = skip with warning, NEVER hang. Display the RAW (unexpanded) command/URL from the config — expansion may inject secrets into args.
- **Secrets never persisted** — spec hashes cover env-var *names* and header *names* only; approval store contains hashes + timestamps, nothing else.
- **Degrade, never crash — but never silent** — a malformed/declined/failed entry warns and drops out; every other server mounts; the run continues.
- **Behavior-preserving default** — the committed `mcp.json` contains exactly today's two mounts (file-tools→`file_qa`, fetch→`web_fetch`); agent names use underscores (`file_qa`, `web_fetch`) matching `Agent.name`.
- **Docs hard line** — the final task updates all four living surfaces (`architecture.md` + `README.md` + `docs/ROADMAP.md` + the snapshot Artifact) and the SDD ledger.
- **Live-verify gate:** real `bun run mcp add` + real npx/uvx pack mounts + `bun run flow`/`crew` end-to-end through the registry on this machine before merge. GitHub remote HTTP live-verified only if a PAT is present, else logged-deferred.

**Existing signatures this plan consumes (verbatim, do not redefine):**

```ts
// src/mcp/client.ts (extended in Task 3, existing shape)
type McpServerSpec = { command: string; args?: string[]; env?: Record<string, string> };
type MountedServer = { tools: ToolSet; close: () => Promise<void> };
function mountMcpServer(spec: McpServerSpec): Promise<MountedServer>;

// src/provisioning/ui/prompt.ts (reused as-is)
type LineInput = { read: () => Promise<string> };
function stdinInput(): LineInput;
function askYesNo(question: string, opts: { input: LineInput; autoYes: boolean }): Promise<boolean>;

// src/workflow/run-step.ts (Task 5 wraps callTool; do not change dispatch semantics)
function callTool(tool: ToolSet[string], args: unknown, callId: string): Promise<unknown>;
// src/telemetry/spans.ts — inSpan/ATTR pattern; add keys to the ATTR const, helpers below it.

// agents — factories take ToolSet (unchanged):
function createFileQaAgent(tools: ToolSet): Agent;      // name: 'file_qa'
function createWebFetchAgent(tools: ToolSet): Agent;    // name: 'web_fetch'
function createSuperAgent(fileQaTools: ToolSet, fetchTools: ToolSet, onBeforeDelegate?: BeforeDelegate): Agent;
```

---

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

### Task 2: Consent store + hashing + prompt flow

**Files:**
- Create: `src/mcp/consent.ts`
- Test: `tests/mcp/consent.test.ts`

**Interfaces:**
- Consumes: `McpServerEntry`, `McpTransportKind` (Task 1); `LineInput`/`askYesNo` (`src/provisioning/ui/prompt.ts`); `node:crypto`, `node:fs`.
- Produces:
  - `specHash(entry: McpServerEntry): string` — sha256 over canonical raw fields: stdio `{command,args,envKeys(sorted)}`, http `{url,headerNames(sorted)}` from the RAW config (unexpanded — no secret values).
  - `toolsHash(tools: ToolSet): string` — sha256 over sorted `name|description|inputSchemaJson` triples.
  - `type ApprovalRecord = { specHash: string; toolsHash?: string; approvedAt: string; declined?: boolean }`
  - `readApprovals(path?: string): Record<string, ApprovalRecord>` / `writeApprovals(store, path?): void` (atomic temp+rename; default path `join(process.cwd(), '.mcp-approvals.json')`)
  - `describeEntry(entry: McpServerEntry): string` — the exact untruncated raw command line or URL + header names.
  - `dangerFlags(entry: McpServerEntry): string[]`
  - `type ConsentDeps = { store: Record<string, ApprovalRecord>; ask: (q: string) => Promise<boolean>; isTTY: boolean; autoYes: boolean; warn: (msg: string) => void }`
  - `ensureConsent(entry: McpServerEntry, deps: ConsentDeps): Promise<boolean>` — mutates `deps.store`; caller persists.
  - `pinTools(store, name, hash): void`; `checkDrift(store, name, hash): boolean` (true = drift).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mcp/consent.test.ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ApprovalRecord,
  checkDrift,
  dangerFlags,
  describeEntry,
  ensureConsent,
  pinTools,
  readApprovals,
  specHash,
  toolsHash,
  writeApprovals,
} from '../../src/mcp/consent.ts';
import { type McpServerEntry, McpTransportKind } from '../../src/mcp/types.ts';

const stdio: McpServerEntry = {
  kind: McpTransportKind.Stdio, name: 'ft', command: 'bun',
  args: ['run', 's.ts'], env: {}, raw: { command: 'bun', args: ['run', 's.ts'] },
};
const http: McpServerEntry = {
  kind: McpTransportKind.Http, name: 'gh', url: 'https://x.test/mcp',
  headers: { Authorization: 'Bearer SECRET' },
  raw: { type: 'http', url: 'https://x.test/mcp', headers: { Authorization: 'Bearer ${T}' } },
};

describe('specHash', () => {
  it('is stable and ignores header VALUES', () => {
    const other = { ...http, headers: { Authorization: 'Bearer DIFFERENT' } };
    expect(specHash(http)).toBe(specHash(other));
  });
  it('changes when the command changes', () => {
    expect(specHash(stdio)).not.toBe(specHash({ ...stdio, command: 'sh', raw: { command: 'sh' } }));
  });
});

describe('toolsHash', () => {
  it('changes when a description changes (rug-pull signal)', () => {
    const a = toolsHash({ t: { description: 'safe', inputSchema: undefined } } as never);
    const b = toolsHash({ t: { description: 'EVIL', inputSchema: undefined } } as never);
    expect(a).not.toBe(b);
  });
});

describe('approval store', () => {
  it('round-trips atomically and degrades on missing file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mcp-appr-')), '.mcp-approvals.json');
    expect(readApprovals(path)).toEqual({});
    const store: Record<string, ApprovalRecord> = {
      ft: { specHash: 'h', approvedAt: '2026-07-02T00:00:00Z' },
    };
    writeApprovals(store, path);
    expect(readApprovals(path)).toEqual(store);
  });
});

describe('ensureConsent', () => {
  const deps = (over: Partial<Parameters<typeof ensureConsent>[1]>) => ({
    store: {}, ask: async () => true, isTTY: true, autoYes: false, warn: () => {}, ...over,
  });
  it('prompts and records approval on first mount', async () => {
    const d = deps({});
    expect(await ensureConsent(stdio, d)).toBe(true);
    expect(d.store.ft?.specHash).toBe(specHash(stdio));
  });
  it('skips silently-approved on matching hash without re-prompting', async () => {
    let asked = 0;
    const d = deps({
      store: { ft: { specHash: specHash(stdio), approvedAt: 'x' } },
      ask: async () => { asked++; return true; },
    });
    expect(await ensureConsent(stdio, d)).toBe(true);
    expect(asked).toBe(0);
  });
  it('re-prompts when the spec hash changed', async () => {
    let asked = 0;
    const d = deps({
      store: { ft: { specHash: 'stale', approvedAt: 'x' } },
      ask: async () => { asked++; return true; },
    });
    await ensureConsent(stdio, d);
    expect(asked).toBe(1);
  });
  it('remembers a decline and does not re-prompt on same spec', async () => {
    const d = deps({ ask: async () => false });
    expect(await ensureConsent(stdio, d)).toBe(false);
    expect(d.store.ft?.declined).toBe(true);
    let asked = 0;
    const d2 = deps({ store: d.store, ask: async () => { asked++; return true; } });
    expect(await ensureConsent(stdio, d2)).toBe(false);
    expect(asked).toBe(0);
  });
  it('non-TTY without autoYes skips (returns false) and never asks', async () => {
    let asked = 0;
    const d = deps({ isTTY: false, ask: async () => { asked++; return true; } });
    expect(await ensureConsent(stdio, d)).toBe(false);
    expect(asked).toBe(0);
    expect(d.store.ft).toBeUndefined(); // a skip is not a decline
  });
  it('autoYes approves without prompting (headless opt-in)', async () => {
    const d = deps({ isTTY: false, autoYes: true, ask: async () => false });
    expect(await ensureConsent(stdio, d)).toBe(true);
  });
});

describe('drift pinning', () => {
  it('pinTools records, checkDrift detects a change', () => {
    const store: Record<string, ApprovalRecord> = { ft: { specHash: 'h', approvedAt: 'x' } };
    pinTools(store, 'ft', 'toolsA');
    expect(checkDrift(store, 'ft', 'toolsA')).toBe(false);
    expect(checkDrift(store, 'ft', 'toolsB')).toBe(true);
  });
});

describe('display + danger', () => {
  it('describeEntry shows raw command and never header values', () => {
    expect(describeEntry(stdio)).toContain('bun run s.ts');
    const d = describeEntry(http);
    expect(d).toContain('https://x.test/mcp');
    expect(d).not.toContain('SECRET');
  });
  it('flags dangerous patterns', () => {
    const risky: McpServerEntry = {
      kind: McpTransportKind.Stdio, name: 'r', command: 'sudo',
      args: ['rm', '-rf', '/'], env: {}, raw: {},
    };
    expect(dangerFlags(risky).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test tests/mcp/consent.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Create `src/mcp/consent.ts`**

```ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolSet } from 'ai';
import { type McpServerEntry, McpTransportKind } from './types.ts';

export type ApprovalRecord = {
  specHash: string;
  toolsHash?: string;
  approvedAt: string;
  declined?: boolean;
};

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Hash the server's identity from RAW config fields — env/header NAMES only,
 *  never values, so secrets are neither hashed nor stored. */
export function specHash(entry: McpServerEntry): string {
  if (entry.kind === McpTransportKind.Http) {
    const raw = entry.raw as { url?: string; headers?: Record<string, string> };
    return sha256(JSON.stringify({
      url: raw.url ?? entry.url,
      headerNames: Object.keys(raw.headers ?? {}).sort(),
    }));
  }
  const raw = entry.raw as { command?: string; args?: string[]; env?: Record<string, string> };
  return sha256(JSON.stringify({
    command: raw.command ?? entry.command,
    args: raw.args ?? entry.args,
    envKeys: Object.keys(raw.env ?? {}).sort(),
  }));
}

/** Hash the mounted tool definitions — the rug-pull pin. */
export function toolsHash(tools: ToolSet): string {
  const parts = Object.entries(tools)
    .map(([name, t]) => {
      let schema = '';
      try {
        const s = (t as { inputSchema?: { jsonSchema?: unknown } }).inputSchema;
        schema = JSON.stringify(s?.jsonSchema ?? null);
      } catch {
        schema = 'unserializable';
      }
      return `${name}|${(t as { description?: string }).description ?? ''}|${schema}`;
    })
    .sort();
  return sha256(parts.join('\n'));
}

export function approvalsPath(): string {
  return join(process.cwd(), '.mcp-approvals.json');
}

export function readApprovals(
  path: string = approvalsPath(),
): Record<string, ApprovalRecord> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, ApprovalRecord>;
  } catch {
    return {}; // corrupt store → re-consent, never crash
  }
}

/** Atomic write (temp + rename) so a failure never corrupts the trust store. */
export function writeApprovals(
  store: Record<string, ApprovalRecord>,
  path: string = approvalsPath(),
): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, path);
}

/** The exact, untruncated thing that will run — from RAW config (unexpanded),
 *  so secrets injected via ${VAR} are never displayed. */
export function describeEntry(entry: McpServerEntry): string {
  if (entry.kind === McpTransportKind.Http) {
    const raw = entry.raw as { url?: string; headers?: Record<string, string> };
    const names = Object.keys(raw.headers ?? {});
    return `${raw.url ?? entry.url}${names.length > 0 ? `  (headers: ${names.join(', ')})` : ''}`;
  }
  const raw = entry.raw as { command?: string; args?: string[] };
  return [raw.command ?? entry.command, ...(raw.args ?? entry.args)].join(' ');
}

const DANGER_PATTERNS: [RegExp, string][] = [
  [/\bsudo\b/, 'runs as sudo'],
  [/\brm\s+-rf?\b/, 'recursive delete'],
  [/curl[^|]*\|\s*(ba|z)?sh/, 'pipes a download into a shell'],
  [/wget[^|]*\|\s*(ba|z)?sh/, 'pipes a download into a shell'],
];

export function dangerFlags(entry: McpServerEntry): string[] {
  const text = describeEntry(entry);
  return DANGER_PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => why);
}

export type ConsentDeps = {
  store: Record<string, ApprovalRecord>;
  ask: (question: string) => Promise<boolean>;
  isTTY: boolean;
  autoYes: boolean;
  warn: (msg: string) => void;
};

/** Consent gate for one entry. Mutates deps.store; the caller persists it.
 *  Non-TTY without autoYes = skip (false) with a warning — NEVER a hang. */
export async function ensureConsent(
  entry: McpServerEntry,
  deps: ConsentDeps,
): Promise<boolean> {
  const hash = specHash(entry);
  const existing = deps.store[entry.name];
  if (existing?.specHash === hash) return !existing.declined;
  if (deps.autoYes) {
    deps.store[entry.name] = { specHash: hash, approvedAt: new Date().toISOString() };
    return true;
  }
  if (!deps.isTTY) {
    deps.warn(`MCP server "${entry.name}" is not approved yet and this is not a TTY — skipping (run interactively or set AGENT_MCP_AUTO_APPROVE=1)`);
    return false;
  }
  const flags = dangerFlags(entry);
  const danger = flags.length > 0 ? `\n  ⚠ ${flags.join('; ')}` : '';
  const changed = existing ? ' (configuration CHANGED since last approval)' : '';
  const ok = await deps.ask(
    `Mount MCP server "${entry.name}"${changed}?\n  ${describeEntry(entry)}${danger}\n  It will run with this process's privileges.`,
  );
  deps.store[entry.name] = {
    specHash: hash,
    approvedAt: new Date().toISOString(),
    ...(ok ? {} : { declined: true }),
  };
  return ok;
}

export function pinTools(
  store: Record<string, ApprovalRecord>,
  name: string,
  hash: string,
): void {
  const rec = store[name];
  if (rec) rec.toolsHash = hash;
}

/** True when the server's tool definitions changed since they were pinned. */
export function checkDrift(
  store: Record<string, ApprovalRecord>,
  name: string,
  hash: string,
): boolean {
  const pinned = store[name]?.toolsHash;
  return pinned !== undefined && pinned !== hash;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/mcp/consent.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Add `.mcp-approvals.json` to `.gitignore`**

Append to `.gitignore` (after the `# Misc` block):

```
# MCP mount trust store (machine-local approvals; never committed). See docs/architecture.md §14
.mcp-approvals.json
```

- [ ] **Step 6: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint:file -- "src/mcp/consent.ts" "tests/mcp/consent.test.ts"`
Expected: clean.

```bash
git add src/mcp/consent.ts tests/mcp/consent.test.ts .gitignore
git commit -m "feat(mcp): consent-on-mount store with spec hashing + tool-definition pinning (Slice 15 Task 2)"
```

---

### Task 3: HTTP transport + `mountAll` with attach resolution

**Files:**
- Modify: `src/mcp/client.ts` (add HTTP branch to `mountMcpServer`)
- Create: `src/mcp/mount.ts`
- Test: `tests/mcp/mount-http.test.ts`
- Test: `tests/mcp/mount-all.test.ts`

**Interfaces:**
- Consumes: `McpConfig`, `McpServerEntry`, `McpTransportKind` (Task 1); `ensureConsent`, `toolsHash`, `pinTools`, `checkDrift`, `readApprovals`, `writeApprovals`, `ConsentDeps` (Task 2); existing `MountedServer`.
- Produces:
  - `type McpMountSpec = McpServerSpec | { type: 'http'; url: string; headers?: Record<string, string> }` — `mountMcpServer(spec: McpMountSpec)` now takes both.
  - `type MountedRegistry = { merged: ToolSet; forAgent(name: string): ToolSet; mounted: { name: string; toolCount: number }[]; skipped: { name: string; reason: string }[]; close(): Promise<void> }`
  - `type MountAllDeps = { mount?: (spec: McpMountSpec) => Promise<MountedServer>; consent?: Partial<ConsentDeps>; approvalsFile?: string; warn?: (msg: string) => void }`
  - `mountAll(config: McpConfig, deps?: MountAllDeps): Promise<MountedRegistry>`
  - `warnUnknownAgents(config: McpConfig, knownAgents: string[], warn: (msg: string) => void): void`

- [ ] **Step 1: Extend `src/mcp/client.ts` with the HTTP branch**

Replace the whole file with:

```ts
import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';

/** How to launch a stdio MCP server. */
export type McpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/** A remote Streamable-HTTP MCP server (static headers; OAuth is a follow-on). */
export type McpHttpSpec = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

export type McpMountSpec = McpServerSpec | McpHttpSpec;

/** A mounted server's tools plus a handle to stop its subprocess/connection. */
export type MountedServer = { tools: ToolSet; close: () => Promise<void> };

/** Connect to ANY stdio or Streamable-HTTP MCP server and expose its tools.
 *  The integration primitive. */
export async function mountMcpServer(
  spec: McpMountSpec,
): Promise<MountedServer> {
  const transport =
    'url' in spec
      ? ({ type: 'http', url: spec.url, headers: spec.headers } as const)
      : new StdioMCPTransport(spec);
  const client = await createMCPClient({ transport });
  const tools = await client.tools();
  return { tools, close: () => client.close() };
}

/** Our local read_file MCP server. */
export function createFileTools(): Promise<MountedServer> {
  return mountMcpServer({ command: 'bun', args: ['run', 'src/mcp/server.ts'] });
}

/** The official keyless web-fetch MCP server (requires uvx). Tool: `fetch`. */
export function createFetchTools(): Promise<MountedServer> {
  return mountMcpServer({ command: 'uvx', args: ['mcp-server-fetch'] });
}
```

- [ ] **Step 2: Write the failing real-HTTP round-trip test**

The test runs a REAL in-process Streamable-HTTP MCP server (official SDK, stateless mode: fresh server+transport per request) on an ephemeral port and mounts it over the network — no external services.

```ts
// tests/mcp/mount-http.test.ts
import { expect, test } from 'bun:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { mountMcpServer } from '../../src/mcp/client.ts';

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = new McpServer({ name: 'http-test', version: '0.0.1' });
  server.registerTool(
    'ping',
    { description: 'ping', inputSchema: { msg: z.string() } },
    async ({ msg }) => ({ content: [{ type: 'text', text: `pong:${msg}` }] }),
  );
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

test('mountMcpServer mounts a real Streamable-HTTP server', async () => {
  const httpServer = createServer((req, res) => {
    handle(req, res).catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
  const addr = httpServer.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  try {
    const { tools, close } = await mountMcpServer({
      type: 'http',
      url: `http://127.0.0.1:${addr.port}/mcp`,
    });
    try {
      expect(tools.ping).toBeDefined();
    } finally {
      await close();
    }
  } finally {
    httpServer.close();
  }
});
```

- [ ] **Step 3: Run both (existing stdio test must still pass; HTTP test must pass)**

Run: `bun test tests/mcp/mount.test.ts tests/mcp/mount-http.test.ts`
Expected: PASS (2 tests). If the HTTP test fails on transport shape, check `@ai-sdk/mcp`'s http transport config — it accepts `{ type: 'http', url, headers }`.

- [ ] **Step 4: Write the failing `mountAll` tests (fake mount fn — no processes)**

```ts
// tests/mcp/mount-all.test.ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MountedServer } from '../../src/mcp/client.ts';
import { readApprovals } from '../../src/mcp/consent.ts';
import { mountAll, warnUnknownAgents } from '../../src/mcp/mount.ts';
import { type McpConfig, McpTransportKind } from '../../src/mcp/types.ts';

const entry = (name: string, agents?: string[]) => ({
  kind: McpTransportKind.Stdio as const,
  name, command: 'fake', args: [], env: {}, agents, raw: { command: 'fake' },
});

const fakeServer = (toolNames: string[]): MountedServer => ({
  tools: Object.fromEntries(
    toolNames.map((n) => [n, { description: n, execute: async () => n }]),
  ) as MountedServer['tools'],
  close: async () => {},
});

const approvalsIn = (dir: string) => join(dir, '.mcp-approvals.json');

function deps(over: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-mount-'));
  return {
    approvalsFile: approvalsIn(dir),
    consent: { autoYes: true, isTTY: false },
    warn: () => {},
    ...over,
  };
}

describe('mountAll', () => {
  it('mounts entries, merges tools, scopes forAgent by the agents field', async () => {
    const config: McpConfig = {
      entries: [entry('a', ['file_qa']), entry('b')], dormant: [], warnings: [],
    };
    const reg = await mountAll(config, deps({
      mount: async (spec: { command?: string; args?: string[] }) =>
        fakeServer(spec.args?.length === 0 ? ['t_shared'] : ['x']),
    }));
    // both entries have args: [] so both serve t_shared → collision: later wins, warn
    expect(Object.keys(reg.merged)).toEqual(['t_shared']);
    expect(reg.mounted).toHaveLength(2);
    await reg.close();
  });
  it('scopes agent slices: scoped entry only for its agents, unscoped for all', async () => {
    let calls = 0;
    const config: McpConfig = {
      entries: [entry('scoped', ['file_qa']), entry('open')], dormant: [], warnings: [],
    };
    const reg = await mountAll(config, deps({
      mount: async () => fakeServer([`tool_${++calls}`]),
    }));
    expect(Object.keys(reg.forAgent('file_qa')).sort()).toEqual(['tool_1', 'tool_2']);
    expect(Object.keys(reg.forAgent('web_fetch'))).toEqual(['tool_2']);
    expect(Object.keys(reg.merged).sort()).toEqual(['tool_1', 'tool_2']);
    await reg.close();
  });
  it('mount failure degrades: boom skipped with reason, ok mounted', async () => {
    const config: McpConfig = {
      entries: [
        { ...entry('boom'), command: 'boom' },
        { ...entry('ok'), command: 'ok' },
      ], dormant: [], warnings: [],
    };
    const reg = await mountAll(config, deps({
      mount: async (spec: { command?: string }) => {
        if (spec.command === 'boom') throw new Error('spawn failed');
        return fakeServer(['t_ok']);
      },
    }));
    expect(reg.mounted.map((m) => m.name)).toEqual(['ok']);
    expect(reg.skipped).toEqual([{ name: 'boom', reason: 'spawn failed' }]);
    await reg.close();
  });
  it('declined consent skips the entry without mounting', async () => {
    const config: McpConfig = { entries: [entry('a')], dormant: [], warnings: [] };
    let mountCalls = 0;
    const reg = await mountAll(config, deps({
      consent: { autoYes: false, isTTY: true, ask: async () => false },
      mount: async () => { mountCalls++; return fakeServer(['t']); },
    }));
    expect(mountCalls).toBe(0);
    expect(reg.skipped[0]?.reason).toContain('consent');
    await reg.close();
  });
  it('pins tool definitions on first mount and persists the store', async () => {
    const d = deps({ mount: async () => fakeServer(['t']) });
    const config: McpConfig = { entries: [entry('a')], dormant: [], warnings: [] };
    const reg = await mountAll(config, d);
    await reg.close();
    const store = readApprovals(d.approvalsFile as string);
    expect(store.a?.toolsHash).toBeDefined();
  });
  it('drift (changed tool defs) with non-interactive consent skips the server', async () => {
    const d = deps({ mount: async () => fakeServer(['t_v1']) });
    const config: McpConfig = { entries: [entry('a')], dormant: [], warnings: [] };
    (await mountAll(config, d)).close();
    // remount with DIFFERENT tools under same approvals file, no TTY, no autoYes
    const reg2 = await mountAll(config, {
      ...d,
      consent: { autoYes: false, isTTY: false },
      mount: async () => fakeServer(['t_v2_changed']),
    });
    expect(reg2.mounted).toHaveLength(0);
    expect(reg2.skipped[0]?.reason).toContain('drift');
    await reg2.close();
  });
});

describe('warnUnknownAgents', () => {
  it('warns for agents lists naming unknown agents', () => {
    const warnings: string[] = [];
    warnUnknownAgents(
      { entries: [entry('a', ['file_qa', 'typo_agent'])], dormant: [], warnings: [] },
      ['file_qa', 'web_fetch'],
      (m) => warnings.push(m),
    );
    expect(warnings[0]).toContain('typo_agent');
  });
});
```

- [ ] **Step 5: Run to verify fail**

Run: `bun test tests/mcp/mount-all.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 6: Create `src/mcp/mount.ts`**

```ts
import type { ToolSet } from 'ai';
import { askYesNo, stdinInput } from '../provisioning/ui/prompt.ts';
import {
  type McpMountSpec,
  type MountedServer,
  mountMcpServer,
} from './client.ts';
import {
  type ApprovalRecord,
  type ConsentDeps,
  approvalsPath,
  checkDrift,
  ensureConsent,
  pinTools,
  readApprovals,
  toolsHash,
  writeApprovals,
} from './consent.ts';
import {
  type McpConfig,
  type McpServerEntry,
  McpTransportKind,
} from './types.ts';

export type MountedRegistry = {
  /** Every mounted tool (workflow tool-steps dispatch by name against this). */
  merged: ToolSet;
  /** The slice an agent sees: unscoped entries + entries listing this agent. */
  forAgent(name: string): ToolSet;
  mounted: { name: string; toolCount: number }[];
  skipped: { name: string; reason: string }[];
  close(): Promise<void>;
};

export type MountAllDeps = {
  mount?: (spec: McpMountSpec) => Promise<MountedServer>;
  consent?: Partial<ConsentDeps>;
  approvalsFile?: string;
  warn?: (msg: string) => void;
};

function toSpec(entry: McpServerEntry): McpMountSpec {
  if (entry.kind === McpTransportKind.Http) {
    return { type: 'http', url: entry.url, headers: entry.headers };
  }
  return { command: entry.command, args: entry.args, env: entry.env };
}

/** Mount every approved config entry; consent-gate first, pin tool definitions
 *  after. Per-entry degrade: one failure never blocks the others. */
export async function mountAll(
  config: McpConfig,
  deps: MountAllDeps = {},
): Promise<MountedRegistry> {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const mount = deps.mount ?? mountMcpServer;
  const approvalsFile = deps.approvalsFile ?? approvalsPath();
  const store: Record<string, ApprovalRecord> = readApprovals(approvalsFile);
  const input = stdinInput();
  const consent: ConsentDeps = {
    store,
    ask: (q) => askYesNo(q, { input, autoYes: false }),
    isTTY: process.stderr.isTTY ?? false,
    autoYes: process.env.AGENT_MCP_AUTO_APPROVE === '1',
    warn,
    ...deps.consent,
  };

  for (const w of config.warnings) warn(w);
  for (const d of config.dormant) {
    warn(`MCP server "${d.name}" is dormant — set ${d.missingVars.join(', ')} to activate it`);
  }

  const servers: { entry: McpServerEntry; server: MountedServer }[] = [];
  const mounted: { name: string; toolCount: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const entry of config.entries) {
    const ok = await ensureConsent(entry, consent);
    if (!ok) {
      skipped.push({ name: entry.name, reason: 'consent not granted' });
      continue;
    }
    let server: MountedServer;
    try {
      server = await mount(toSpec(entry));
    } catch (cause) {
      warn(`MCP server "${entry.name}" failed to mount: ${(cause as Error).message}`);
      skipped.push({ name: entry.name, reason: (cause as Error).message });
      continue;
    }
    const hash = toolsHash(server.tools);
    if (checkDrift(store, entry.name, hash)) {
      warn(`MCP server "${entry.name}" changed its tool definitions since approval (possible rug-pull)`);
      const reOk = consent.autoYes
        ? true
        : consent.isTTY
          ? await consent.ask(`Tool definitions for "${entry.name}" CHANGED. Re-approve?`)
          : false;
      if (!reOk) {
        await server.close().catch(() => {});
        skipped.push({ name: entry.name, reason: 'tool-definition drift not re-approved' });
        continue;
      }
    }
    pinTools(store, entry.name, hash);
    servers.push({ entry, server });
    mounted.push({ name: entry.name, toolCount: Object.keys(server.tools).length });
  }

  try {
    writeApprovals(store, approvalsFile);
  } catch (cause) {
    warn(`could not persist MCP approvals: ${(cause as Error).message}`);
  }

  const merged: ToolSet = {};
  for (const { entry, server } of servers) {
    for (const [name, t] of Object.entries(server.tools)) {
      if (merged[name]) {
        warn(`tool "${name}" from MCP server "${entry.name}" overrides an earlier server's tool of the same name`);
      }
      merged[name] = t;
    }
  }

  return {
    merged,
    forAgent(agentName: string): ToolSet {
      const slice: ToolSet = {};
      for (const { entry, server } of servers) {
        if (entry.agents && !entry.agents.includes(agentName)) continue;
        Object.assign(slice, server.tools);
      }
      return slice;
    },
    mounted,
    skipped,
    async close(): Promise<void> {
      for (const { entry, server } of servers) {
        try {
          await server.close();
        } catch (cause) {
          warn(`closing MCP server "${entry.name}" failed: ${(cause as Error).message}`);
        }
      }
    },
  };
}

/** Typo guard: warn when an entry's agents list names an agent that doesn't exist. */
export function warnUnknownAgents(
  config: McpConfig,
  knownAgents: string[],
  warn: (msg: string) => void,
): void {
  const known = new Set(knownAgents);
  for (const entry of config.entries) {
    for (const a of entry.agents ?? []) {
      if (!known.has(a)) {
        warn(`mcp.json entry "${entry.name}" targets unknown agent "${a}" (known: ${knownAgents.join(', ')})`);
      }
    }
  }
}
```

- [ ] **Step 7: Run to verify pass**

Run: `bun test tests/mcp/mount-all.test.ts tests/mcp/mount-http.test.ts tests/mcp/mount.test.ts`
Expected: PASS (all).

- [ ] **Step 8: Typecheck + lint + commit**

Run: `bun run typecheck && bun run lint:file -- "src/mcp/client.ts" "src/mcp/mount.ts" "tests/mcp/mount-all.test.ts" "tests/mcp/mount-http.test.ts"`
Expected: clean.

```bash
git add src/mcp/client.ts src/mcp/mount.ts tests/mcp/mount-all.test.ts tests/mcp/mount-http.test.ts
git commit -m "feat(mcp): Streamable-HTTP mounting + mountAll registry with consent gate, drift check, attach resolution (Slice 15 Task 3)"
```

---

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

### Task 5: Tool telemetry + CLI wiring (chat/flow/crew) + default `mcp.json`

**Files:**
- Modify: `src/telemetry/spans.ts` (ATTR keys + `withToolSpan` + `recordMountOutcome`)
- Modify: `src/workflow/run-step.ts` (wrap `callTool` in `withToolSpan`)
- Modify: `src/cli/flow.ts`, `src/cli/crew.ts`, `src/cli/chat.ts` (registry mounts)
- Create: `mcp.json` (committed default — today's two mounts)
- Test: `tests/mcp/tool-span.test.ts`

**Interfaces:**
- Consumes: `loadMcpConfig` (Task 1), `mountAll`/`warnUnknownAgents`/`MountedRegistry` (Task 3).
- Produces:
  - `ATTR.TOOL_NAME = 'gen_ai.tool.name'`, `ATTR.MCP_SERVER = 'mcp.server'`, `ATTR.MCP_TRANSPORT = 'mcp.transport'`, `ATTR.MCP_TOOL_COUNT = 'mcp.tool.count'`, `ATTR.MCP_MOUNT_OUTCOME = 'mcp.mount.outcome'`
  - `withToolSpan<T>(toolName: string, fn: () => Promise<T>): Promise<T>` — span `workflow.tool`.
  - `withMcpMountSpan<T>(fn: (record: (name: string, outcome: string, toolCount?: number) => void) => Promise<T>): Promise<T>` — span `mcp.mount` with per-server `mcp.server.mount` events.

- [ ] **Step 1: Write the failing span test**

```ts
// tests/mcp/tool-span.test.ts
import { describe, expect, it } from 'bun:test';
import { withMcpMountSpan, withToolSpan } from '../../src/telemetry/spans.ts';

// No provider initialized → no-op tracer; helpers must pass results through
// and propagate errors (the provider-attached path is exercised by run-viewer live tests).
describe('withToolSpan', () => {
  it('passes the function result through', async () => {
    expect(await withToolSpan('echo', async () => 42)).toBe(42);
  });
  it('propagates errors', async () => {
    await expect(withToolSpan('boom', async () => { throw new Error('x'); })).rejects.toThrow('x');
  });
});

describe('withMcpMountSpan', () => {
  it('hands the recorder to the body and returns its result', async () => {
    const out = await withMcpMountSpan(async (record) => {
      record('file-tools', 'mounted', 1);
      record('gh', 'dormant');
      return 'ok';
    });
    expect(out).toBe('ok');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test tests/mcp/tool-span.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Extend `src/telemetry/spans.ts`**

Add to the `ATTR` const (after `PROVISION_SNAPSHOT_FALLBACK`):

```ts
  TOOL_NAME: 'gen_ai.tool.name',
  MCP_SERVER: 'mcp.server',
  MCP_TRANSPORT: 'mcp.transport',
  MCP_TOOL_COUNT: 'mcp.tool.count',
  MCP_MOUNT_OUTCOME: 'mcp.mount.outcome',
```

Add at the end of the file:

```ts
/** Span for one engine-level tool call (StepKind.Tool) — closes the gap where
 *  direct tool dispatch ran uninstrumented (agent-internal tool calls are
 *  already covered by AI-SDK experimental_telemetry). */
export function withToolSpan<T>(
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return inSpan('workflow.tool', async (span) => {
    span.setAttribute(ATTR.TOOL_NAME, toolName);
    return fn();
  });
}

/** Root span for an MCP mount pass; the body records one event per server. */
export function withMcpMountSpan<T>(
  fn: (record: (name: string, outcome: string, toolCount?: number) => void) => Promise<T>,
): Promise<T> {
  return inSpan('mcp.mount', async (span) => {
    let servers = 0;
    const record = (name: string, outcome: string, toolCount?: number): void => {
      servers += 1;
      span.addEvent('mcp.server.mount', {
        [ATTR.MCP_SERVER]: name,
        [ATTR.MCP_MOUNT_OUTCOME]: outcome,
        ...(toolCount !== undefined ? { [ATTR.MCP_TOOL_COUNT]: toolCount } : {}),
      });
    };
    const out = await fn(record);
    span.setAttribute(ATTR.MCP_TOOL_COUNT, servers);
    return out;
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/mcp/tool-span.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wrap engine tool dispatch in `src/workflow/run-step.ts`**

Add `withToolSpan` to the existing spans import, then change the two `callTool` call sites (semantics unchanged — same args, same errors):

In `runLeaf`:

```ts
  const tool = deps.tools[sub.tool];
  if (!tool?.execute) throw new WorkflowError(`unknown tool: ${sub.tool}`);
  return withToolSpan(sub.tool, () => callTool(tool, sub.input(ctx), callId));
```

In `runStepByKind` (`case StepKind.Tool`):

```ts
    case StepKind.Tool: {
      const tool = deps.tools[step.tool];
      if (!tool?.execute) {
        return Promise.reject(new WorkflowError(`unknown tool: ${step.tool}`));
      }
      return withToolSpan(step.tool, () => callTool(tool, step.input(ctx), step.id));
    }
```

Run: `bun test tests/workflow/` — Expected: PASS (no behavior change).

- [ ] **Step 6: Create the committed default `mcp.json` (repo root)**

```json
{
  "mcpServers": {
    "file-tools": {
      "command": "bun",
      "args": ["run", "src/mcp/server.ts"],
      "agents": ["file_qa"]
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "agents": ["web_fetch"]
    }
  }
}
```

- [ ] **Step 7: Rewire `src/cli/flow.ts`**

Replace the `createFetchTools, createFileTools` import with:

```ts
import { loadMcpConfig } from '../mcp/config.ts';
import { mountAll, warnUnknownAgents } from '../mcp/mount.ts';
import { withMcpMountSpan } from '../telemetry/spans.ts';
```

Replace the mount region of `main()` — from `const fileServer = await createFileTools();` through its matching final `finally { await fileServer.close(); }` — with (inner body unchanged except the marked lines):

```ts
  const config = loadMcpConfig();
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    const selection = await createSelectionRuntime();
    try {
      const tools: ToolSet = reg.merged;
      const agents: Record<string, Agent> = {};
      const fileQa = createFileQaAgent(reg.forAgent('file_qa'));
      const webFetch = createWebFetchAgent(reg.forAgent('web_fetch'));
      agents[fileQa.name] = fileQa;
      agents[webFetch.name] = webFetch;
      warnUnknownAgents(config, Object.keys(agents), (m) => console.error(m));

      const verifyRuntime = verify ? makeRealVerifyDeps() : undefined;
      try {
        const outcome = await runFlow({
          def,
          input: positional.join(' ').trim(),
          runsRoot: 'runs',
          runId: `flow-${process.pid}`,
          agents,
          tools,
          onBeforeDelegate: selection.onBeforeDelegate,
          verifyDeps: verifyRuntime?.verifyDeps,
        });
        if (outcome.kind === 'done') {
          console.log(lastStepOutputText(def, outcome.output));
        } else if (outcome.kind === 'unverified') {
          console.error(
            `Workflow abstained at ${outcome.failedStepId ?? '?'} (unverified, faithfulness ${outcome.faithfulness}): ${outcome.unsupportedClaims.join('; ')}`,
          );
          process.exitCode = 1;
        } else {
          console.error(
            `Workflow failed at ${outcome.failedStep}: ${outcome.message}`,
          );
          process.exitCode = 1;
        }
      } finally {
        if (verifyRuntime) {
          verifyRuntime.store.close();
          await verifyRuntime.manager.unloadAll();
        }
      }
    } finally {
      await selection.close();
    }
  } finally {
    await reg.close();
  }
```

- [ ] **Step 8: Rewire `src/cli/crew.ts` (same pattern)**

Same import swap as Step 7. Replace its mount region — `const fileServer = await createFileTools();` through the final `finally { await fileServer.close(); }` — keeping the inner body identical except `const tools: ToolSet = { ...fileServer.tools, ...fetchServer.tools };` becomes `const tools: ToolSet = reg.merged;`, wrapped in:

```ts
  const config = loadMcpConfig();
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    // ... existing selection/verify/runCrewCli body, tools = reg.merged ...
  } finally {
    await reg.close();
  }
```

(Crew members without per-member `tools` fall back to the merged set via `buildCrewAgent(member, tools)` — unchanged behavior.)

- [ ] **Step 9: Rewire `src/cli/chat.ts`**

Same import swap. Replace the mount region — `const fileServer = await createFileTools();` through `await fileServer.close();` (keep `await manager.unloadAll();` in the outer finally) — with:

```ts
  const config = loadMcpConfig();
  const reg = await withMcpMountSpan(async (record) => {
    const r = await mountAll(config);
    for (const m of r.mounted) record(m.name, 'mounted', m.toolCount);
    for (const s of r.skipped) record(s.name, s.reason);
    for (const d of config.dormant) record(d.name, 'dormant');
    return r;
  });
  try {
    const orchestrator = createSuperAgent(
      reg.forAgent('file_qa'),
      reg.forAgent('web_fetch'),
      onBeforeDelegate,
    );
    const result = await runChat({
      orchestrator,
      task,
      runsRoot: 'runs',
      runId: `run-${process.pid}`,
      routerNumCtx,
      capture,
    });
    if (result.kind === 'answer') {
      console.log(result.text);
    } else if (result.kind === 'gap') {
      console.log(result.message);
    } else {
      console.error(result.message);
      process.exitCode = 1;
    }
  } finally {
    await reg.close();
    await manager.unloadAll();
  }
```

`maybeAutoProvision()` and everything above the mount region stay untouched.

- [ ] **Step 10: First-run consent seeding note + full gate**

The committed default `mcp.json` entries are NOT pre-approved: the first interactive `bun run flow|crew|chat` prompts once per server (y → recorded in `.mcp-approvals.json`). Non-TTY runs skip unapproved servers with a warning (tests construct deps directly, so the suite is unaffected).

Run: `bun run docs:check && bun run typecheck && bun run lint` then `bun test`
Expected: all clean/green (pre-existing pass counts + the new mcp tests).

- [ ] **Step 11: Commit**

```bash
git add src/telemetry/spans.ts src/workflow/run-step.ts src/cli/flow.ts src/cli/crew.ts src/cli/chat.ts mcp.json tests/mcp/tool-span.test.ts
git commit -m "feat(mcp): registry-driven CLI mounts + workflow.tool/mcp.mount telemetry + default mcp.json (Slice 15 Task 5)"
```

---

### Task 6: Scoping eval + docs (all four surfaces) + live-verify

**Files:**
- Create: `tests/mcp/eval-scoping.test.ts`
- Modify: `docs/architecture.md` (new §14 + both Mermaid diagrams + glossary; renumber On-disk/Testing/Glossary)
- Modify: `README.md` (Status line, slice table row, feature paragraph, Next line)
- Modify: `docs/ROADMAP.md` (flip Phase C registry+pack markers; add "Slice 15 follow-ons" block from spec §12)
- Modify: `.superpowers/sdd/progress.md` (Slice 15 entries)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–5; live Ollama (auto-skip when down).

- [ ] **Step 1: Write the scoping eval (live-gated, auto-skip)**

Mirrors the Slice-14 fit eval: in-repo, runs only when Ollama is up; produces the evidence for the per-server `agents` decision. Scoped agents must reliably pick the right tool; the merged-set accuracy is logged for comparison, not asserted (avoids a flaky gate).

```ts
// tests/mcp/eval-scoping.test.ts
import { describe, expect, it } from 'bun:test';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import qwenFast from '../../models/qwen-fast.ts';
import { createOllamaModel } from '../../src/providers/ollama.ts';

const ollamaUp = await fetch('http://localhost:11434/api/tags').then(() => true).catch(() => false);

const noop = (name: string, desc: string) =>
  tool({
    description: desc,
    inputSchema: z.object({ input: z.string() }),
    execute: async () => ({ ok: name }),
  });

// A merged-set stand-in shaped like the real pack: many plausible distractors.
const MERGED = {
  read_file: noop('read_file', 'Read a UTF-8 text file from disk.'),
  fetch: noop('fetch', 'Fetch a URL and return page content.'),
  query: noop('query', 'Run a read-only SQL SELECT.'),
  execute: noop('execute', 'Run a writing SQL statement.'),
  git_log: noop('git_log', 'Show git commit history.'),
  browser_navigate: noop('browser_navigate', 'Open a page in a browser.'),
  create_entities: noop('create_entities', 'Store entities in the knowledge graph.'),
  get_time: noop('get_time', 'Get the current time in a timezone.'),
};
const SCOPED = { read_file: MERGED.read_file };

const CASES = [
  'Read the file ./README.md and tell me its first heading.',
  'What are the contents of package.json?',
  'Open ./docs/ROADMAP.md and summarize it.',
  'Show me what is inside src/mcp/pack.ts.',
];

async function firstToolPicked(tools: Record<string, unknown>, prompt: string): Promise<string | undefined> {
  const r = await generateText({
    model: createOllamaModel(qwenFast),
    tools: tools as Parameters<typeof generateText>[0]['tools'],
    prompt,
  });
  return r.toolCalls[0]?.toolName;
}

describe.skipIf(!ollamaUp)('eval: agents-field scoping vs merged toolset', () => {
  it('scoped agent picks read_file ≥3/4; merged accuracy logged for comparison', async () => {
    let scopedHits = 0;
    let mergedHits = 0;
    for (const c of CASES) {
      if ((await firstToolPicked(SCOPED, c)) === 'read_file') scopedHits++;
      if ((await firstToolPicked(MERGED, c)) === 'read_file') mergedHits++;
    }
    console.error(`[eval] scoped ${scopedHits}/4 vs merged ${mergedHits}/4 (read_file tasks)`);
    expect(scopedHits).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
```

Run: `bun test tests/mcp/eval-scoping.test.ts` (with `bun run serve` up)
Expected: PASS with the comparison line printed; SKIP cleanly when Ollama is down.

- [ ] **Step 2: LIVE-VERIFY (merge gate) — real registry end-to-end**

With `bun run serve` up, run each and record results in the SDD ledger:

```bash
bun run mcp list                        # 12 entries render
bun run mcp add git && bun run mcp add sqlite && bun run mcp status
bun run flow fetch-then-summarize "https://example.com"   # consent prompts fire (y), fetch works via registry
bun run src/cli/chat.ts "what is in package.json?"        # file_qa gets ONLY file-tools slice
bun run crew <existing-crew> "<input>"                    # crew path through reg.merged
```

Expected: first run prompts consent per server (exact command shown); approvals persist (second run does not re-prompt); `runs/<id>/` traces show `mcp.mount` + `workflow.tool` spans. GitHub remote HTTP: live-verify only if `GITHUB_PAT` is set; otherwise record "logged-deferred" in the ledger. Revert the `mcp.json` additions after verifying (`git checkout mcp.json`) so the committed default stays minimal.

- [ ] **Step 3: `docs/architecture.md` — new §14 + diagrams**

- Insert a new `## 14. MCP mount registry & starter pack (Slice 15)` after §13 Provisioning; renumber On-disk stores → §15, Testing strategy → §16, Glossary → §17. Content: the `src/mcp/` module list (`types/config/consent/mount/pack/client/server/sqlite-server` + `src/cli/mcp.ts`), the load→consent→mount→pin→attach flow, the spec-hash/tools-hash pinning model (secrets never stored, `.mcp-approvals.json` untracked), the dormant-until-key behavior, and the pack-as-Phase-D-palette role.
- Module map (§2): inside the `MCP` subgraph add `mcpconfig["config.ts · loadMcpConfig"]`, `mcpmount["mount.ts · mountAll"]`, `mcppack["pack.ts · STARTER_PACK"]`; add `mcp.json` + the registry to the `Declarations` subgraph as a peer of `workflows/*`/`crews/*`; reroute the `chat`/`flow`/`crewcli` dotted "mounts" edges to `mcpmount`, keep `agents -. hold tools .-> mcpclient`.
- Data-flow (§3): change the line `CLI->>CLI: buildRegistry() (offline merge) + mount MCP tools` to reflect `loadMcpConfig() → consent gate → mountAll()`.
- Layer table row **Tools / MCP**: add `config/consent/mount/pack` to the "what" column; glossary "Mounting an MCP server" entry: presets → registry + pack, mention consent + pinning.
- Update §16 Testing strategy with the real HTTP round-trip + sqlite round-trip tests.

Run: `bun run docs:check` — Expected: clean.

- [ ] **Step 4: `README.md`**

- Status line → Slice 15 shipped (mcp.json registry + starter pack).
- Slice status table: add `| 15 | mcp.json mount registry + starter pack | ✅ Done |`.
- Feature paragraph: replace the "1 mounted MCP server" phrasing with the registry + 12-entry pack + `bun run mcp` CLI; add the consent-on-mount + pinning sentence.
- "Next" line → Phase D agent-builder (or Codex-delegate follow-on).

- [ ] **Step 5: `docs/ROADMAP.md`**

- Phase C table: mark **Declarative `mcp.json` mount registry** and **Starter integration pack** ✅ shipped, Slice 15 (Codex backup stays open).
- Gap table line 50: `🟡 1 server — needs a mount registry + pack` → `✅ mcp.json registry + 12-entry pack (Slice 15)`.
- Recommended sequence item 8 → `✅ shipped, Slice 15`.
- Add `### Slice 15 follow-ons (deferred deliberately — MUST be included in future, not dropped)` mirroring spec §12: Codex delegate · OAuth (`authProvider`) · live official-registry query (v0.1/GA-pending) · shell server (sandboxing design) · `list_changed`/notifications (pinning+restart is the posture) · roots/sampling (spec-deprecated) · spec-2026-07-28/TS-SDK-v2 migration follow-on.
- Update the product-surface prose (lines 38-42) tool counts.

- [ ] **Step 6: SDD ledger + full gate + commit**

Append the Slice 15 banner + per-task lines to `.superpowers/sdd/progress.md` (format: `S15 Task N: complete (commits a..b, review ...)`), including live-verify results and any logged-deferred items (GitHub PAT).

Run: `bun run docs:check && bun run typecheck && bun run lint` then `bun test`
Expected: all green.

```bash
git add tests/mcp/eval-scoping.test.ts docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(mcp): Slice 15 architecture §14 + README/ROADMAP + scoping eval + SDD ledger (Slice 15 Task 6)"
```

- [ ] **Step 7: Regenerate the snapshot Artifact (manual reminder — tooling can only remind)**

Regenerate the interactive architecture Artifact from the updated `architecture.md`: add the MCP-registry node/edges (config→consent→mount→agents/workflow), a "Mounted deliberately" concept card, a `mcp` Terminal scenario (load→consent→mount→pin→attach→span), and bump the footer to "15 slices · <new test count> tests". Redeploy to the SAME url (`claude.ai/code/artifact/c760844f-edb5-4d7c-a965-6af76423c666`).

---

## Self-Review

**Spec coverage:** §4 format/expansion/dormant/per-entry degrade/`servers`-root tolerance → Task 1; §6 consent + spec-hash + pinning + non-TTY skip + danger flags + untracked store → Task 2 (+ `.gitignore`); §2+§7 transports (stdio+HTTP), `mountAll`, attach resolution, merged-for-tool-steps, unknown-agent warning, aggregate close → Task 3; §5 pack (12 entries, capability tags, no archived invocations) + sqlite server + `bun run mcp` CLI → Task 4; §7 startup flow in all three CLIs + committed default `mcp.json` + §9 telemetry (`withToolSpan` closing the `StepKind.Tool` gap, `mcp.mount` events) → Task 5; §11 eval + live-verify and §10 architecture-doc + four surfaces + §12 deferrals recorded in ROADMAP → Task 6. No gaps.

**Placeholder scan:** every code step shows complete code; test steps have real assertions; commands are exact with expected outcomes. Task 6 docs steps describe exact insertion points rather than full file bodies (the four surfaces are prose edits audited by the final review, per house convention).

**Type consistency:** `McpServerEntry`/`McpConfig`/`McpTransportKind`/`PackEntry` defined in Task 1, consumed verbatim in Tasks 2–5; `ApprovalRecord`/`ConsentDeps`/`specHash`/`toolsHash`/`pinTools`/`checkDrift` defined in Task 2, consumed in Task 3's `mountAll`; `McpMountSpec`/`MountedServer` (Task 3 client.ts) consumed by `mount.ts` and the sqlite/HTTP tests; `MountedRegistry.{merged,forAgent,mounted,skipped,close}` produced in Task 3, consumed by all three CLI rewires in Task 5; `withToolSpan`/`withMcpMountSpan`/`ATTR.TOOL_NAME`/`ATTR.MCP_*` defined in Task 5 Step 3 and consumed in Steps 5/7–9. Agent names `file_qa`/`web_fetch` (underscores) used consistently in `mcp.json`, pack entries, `forAgent` calls, and tests.
