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

