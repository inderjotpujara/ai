# Slice 3: Mount Any MCP Server + Web-Fetch Specialist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `mountMcpServer(spec)` primitive that connects to any stdio MCP server, proven by mounting the keyless `uvx mcp-server-fetch` as a second `web_fetch` specialist the orchestrator routes to.

**Architecture:** Generalize the existing MCP client into `mountMcpServer({command,args,env?})`; `createFileTools`/`createFetchTools` become presets. Add a `web_fetch` agent that holds the mounted `fetch` tool, register it on the orchestrator beside `file_qa`, and have the CLI mount both servers. No engine changes — agents-as-tools from Slice 2 already routes.

**Tech Stack:** Bun + TypeScript + Vercel AI SDK 6 (`ai@^6`), `@ai-sdk/mcp@^1`, `zod@^4`; external server `uvx mcp-server-fetch` (Python, via uvx 0.11.19). Tests: `bun test` with `MockLanguageModelV3` + opt-in live tests auto-skipped via `uvxReady()`/`ollamaReady()`.

## Global Constraints

- Stack: Bun + TS, ESM. Pins unchanged: `ai@^6`, `@ai-sdk/mcp@^1` (1.0.55), `ollama-ai-provider-v2@^3`, `@modelcontextprotocol/sdk@^1`, `zod@^4`. **No dependency bumps.**
- Code style: `type` over `interface`; string enums for finite sets; early returns; small single-responsibility files; plain self-explanatory code; **no `!` non-null assertions** (use optional chaining); typed errors.
- **MCP mount API (verified against installed `@ai-sdk/mcp@1.0.55`):** `createMCPClient({ transport: new Experimental_StdioMCPTransport({ command, args?, env?, cwd?, stderr? }) })`; `await client.tools()` returns a `ToolSet` keyed by the server's **raw tool names** (un-prefixed); `await client.close()` stops the subprocess. `StdioConfig` accepts `env` (confirmed in the dist types).
- **Fetch server:** `uvx mcp-server-fetch` (official, keyless, respects robots.txt by default). Exposes ONE tool named exactly **`fetch`**, input `{ url: string, max_length?: number (default 5000), start_index?: number, raw?: boolean }`, returns markdown text. First `uvx` run downloads ~2–5s.
- **uvx is now a prerequisite for the real CLI** (the web_fetch agent needs it). Unit/mock tests do NOT need uvx or network; only the opt-in live tests do. `bun test` stays green without uvx/Ollama/network.
- Tests: `bun run test:file -- ./path`; `bun run typecheck`; `bun run lint` (a `biome.json` deprecation NOTICE is acceptable — no errors). Mirror the proven mock-model shape from `tests/core/agent.test.ts` (`finishReason:{unified,raw}`, nested `usage`, tool-call `input: JSON.stringify({...})`).
- git is initialized; you are on branch `slice-3-mcp-integration`. Commit each task; do NOT `git init`.

---

### Task 1: `mountMcpServer` primitive + presets

**Files:**
- Modify: `src/mcp/client.ts`
- Test: `tests/mcp/mount.test.ts`

**Interfaces:**
- Consumes: `createMCPClient` (`@ai-sdk/mcp`), `Experimental_StdioMCPTransport` (`@ai-sdk/mcp/mcp-stdio`), `ToolSet` (ai).
- Produces:
  - `type McpServerSpec = { command: string; args?: string[]; env?: Record<string, string> }`
  - `type MountedServer = { tools: ToolSet; close: () => Promise<void> }`
  - `mountMcpServer(spec: McpServerSpec): Promise<MountedServer>`
  - `createFileTools(): Promise<MountedServer>` (preset — unchanged behavior, now via mountMcpServer)
  - `createFetchTools(): Promise<MountedServer>` (preset — `uvx mcp-server-fetch`)

- [ ] **Step 1: Write the failing test** — `tests/mcp/mount.test.ts`

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mountMcpServer } from '../../src/mcp/client.ts';

// Proves mountMcpServer is generic (not hardcoded to one server) by mounting our
// OWN read_file server through it. Real subprocess; needs bun, no network.
test('mountMcpServer mounts an arbitrary stdio server and exposes its tools', async () => {
  const { tools, close } = await mountMcpServer({
    command: 'bun',
    args: ['run', 'src/mcp/server.ts'],
  });
  try {
    expect(tools.read_file).toBeDefined();
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/mcp/mount.test.ts`
Expected: FAIL — `mountMcpServer` not exported from client.ts.

- [ ] **Step 3: Rewrite `src/mcp/client.ts`**

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

/** A mounted server's tools plus a handle to stop its subprocess. */
export type MountedServer = { tools: ToolSet; close: () => Promise<void> };

/** Connect to ANY stdio MCP server and expose its tools. The integration primitive. */
export async function mountMcpServer(spec: McpServerSpec): Promise<MountedServer> {
  const client = await createMCPClient({
    transport: new StdioMCPTransport(spec),
  });
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:file -- ./tests/mcp/mount.test.ts` then `bun run test:file -- ./tests/mcp/server.test.ts` then `bun run typecheck`
Expected: both test files PASS (the existing read_file MCP test still passes — `createFileTools` behavior is unchanged); typecheck 0.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/client.ts tests/mcp/mount.test.ts
git commit -m "feat(mcp): add mountMcpServer primitive; createFileTools/createFetchTools as presets"
```

---

### Task 2: `web_fetch` agent definition

**Files:**
- Create: `agents/web-fetch.ts`
- Test: `tests/agents/web-fetch.test.ts`

**Interfaces:**
- Consumes: `Agent` (`src/core/agent-def.ts`), `createOllamaModel` (`src/providers/ollama.ts`), `qwenFast` (`models/qwen-fast.ts`), `ToolSet` (ai).
- Produces: `createWebFetchAgent(tools: ToolSet): Agent` — name `'web_fetch'`, a web/URL description, model from `qwenFast`, a prompt instructing use of the `fetch` tool, injected `tools`.

- [ ] **Step 1: Write the failing test** — `tests/agents/web-fetch.test.ts`

```ts
import { expect, test } from 'bun:test';
import { createWebFetchAgent } from '../../agents/web-fetch.ts';

test('web-fetch agent has the expected identity and injected tools', () => {
  const tools = { fetch: { description: 'x' } } as never;
  const agent = createWebFetchAgent(tools);
  expect(agent.name).toBe('web_fetch');
  expect(agent.description.toLowerCase()).toContain('url');
  expect(agent.tools).toBe(tools);
  expect(agent.model).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/agents/web-fetch.test.ts`
Expected: FAIL — cannot resolve `agents/web-fetch.ts`.

- [ ] **Step 3: Create `agents/web-fetch.ts`**

```ts
import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';

const SYSTEM_PROMPT =
  'You answer questions about web pages. Use the fetch tool to retrieve the given URL, then answer or summarize concisely based on the page content.';

/** Build the web-fetch agent with an injected tool set (the mounted `fetch` tool). */
export function createWebFetchAgent(tools: ToolSet): Agent {
  return {
    name: 'web_fetch',
    description:
      'Fetches a URL and answers questions about or summarizes the content of a web page.',
    model: createOllamaModel(qwenFast),
    systemPrompt: SYSTEM_PROMPT,
    tools,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/agents/web-fetch.test.ts` then `bun run typecheck`
Expected: PASS; typecheck 0.

- [ ] **Step 5: Commit**

```bash
git add agents/web-fetch.ts tests/agents/web-fetch.test.ts
git commit -m "feat(agents): add web_fetch agent backed by the fetch MCP tool"
```

---

### Task 3: Register `web_fetch` on the orchestrator

**Files:**
- Modify: `agents/super.ts`
- Modify: `tests/agents/super.test.ts`
- Modify: `tests/core/orchestrator.test.ts` (add a 2-specialist routing test)

**Interfaces:**
- Consumes: `createOrchestrator` (`src/core/orchestrator.ts`), `createFileQaAgent` (`agents/file-qa.ts`), `createWebFetchAgent` (`agents/web-fetch.ts`), `createOllamaModel`, `qwenFast`, `ToolSet`.
- Produces: **`createSuperAgent(fileQaTools: ToolSet, fetchTools: ToolSet): Agent`** (signature now takes both tool sets) returning an orchestrator over `[fileQa, webFetch]`.

- [ ] **Step 1: Update the failing test** — replace the body of `tests/agents/super.test.ts`

```ts
import { expect, test } from 'bun:test';
import { createSuperAgent } from '../../agents/super.ts';
import { CAPABILITY_GAP_TOOL } from '../../src/core/capability-gap.ts';

test('super agent exposes delegate tools for both specialists and the gap tool', () => {
  const fileTools = { read_file: { description: 'x' } } as never;
  const fetchTools = { fetch: { description: 'x' } } as never;
  const sup = createSuperAgent(fileTools, fetchTools);
  const toolNames = Object.keys(sup.tools);
  expect(toolNames).toContain('delegate_to_file_qa');
  expect(toolNames).toContain('delegate_to_web_fetch');
  expect(toolNames).toContain(CAPABILITY_GAP_TOOL);
  expect(sup.model).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/agents/super.test.ts`
Expected: FAIL — `createSuperAgent` currently takes one arg / lacks `delegate_to_web_fetch`.

- [ ] **Step 3: Rewrite `agents/super.ts`**

```ts
import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { createOrchestrator } from '../src/core/orchestrator.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import { createFileQaAgent } from './file-qa.ts';
import { createWebFetchAgent } from './web-fetch.ts';

const BASE_PROMPT =
  'You are an orchestrator. You do not perform tasks yourself; you route them to specialized agents.';

/** Build the super-agent (orchestrator) with file-Q&A and web-fetch registered. */
export function createSuperAgent(
  fileQaTools: ToolSet,
  fetchTools: ToolSet,
): Agent {
  const fileQa = createFileQaAgent(fileQaTools);
  const webFetch = createWebFetchAgent(fetchTools);
  return createOrchestrator({
    name: 'super',
    model: createOllamaModel(qwenFast),
    systemPrompt: BASE_PROMPT,
    agents: [fileQa, webFetch],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/agents/super.test.ts` then `bun run typecheck`
Expected: PASS; typecheck 0.

- [ ] **Step 5: Add a 2-specialist routing test** — append to `tests/core/orchestrator.test.ts`

```ts
test('routes a URL task to web_fetch and a file task to file_qa', async () => {
  const fileQa = subAgent('file_qa', 'file answer');
  const webFetch = subAgent('web_fetch', 'web answer');

  // model that picks delegate_to_web_fetch
  const orchWeb = createOrchestrator({
    model: orchModel('delegate_to_web_fetch', { task: 'summarize https://example.com' }),
    systemPrompt: 'route',
    agents: [fileQa.agent, webFetch.agent],
  });
  const webResult = await runOrchestrator(orchWeb, 'summarize https://example.com');
  expect(webResult.kind).toBe('answer');
  expect(fileQa.ran()).toBe(0);
  expect(webFetch.ran()).toBe(1);
});
```

(This reuses the existing `subAgent` and `orchModel` helpers already defined at the top of `orchestrator.test.ts`. Place this test after the existing `multi-agent selection` test.)

- [ ] **Step 6: Run tests + full suite**

Run: `bun run test:file -- ./tests/core/orchestrator.test.ts` then `bun test` then `bun run lint`
Expected: orchestrator tests PASS; full suite PASS; lint 0 errors.

- [ ] **Step 7: Commit**

```bash
git add agents/super.ts tests/agents/super.test.ts tests/core/orchestrator.test.ts
git commit -m "feat(agents): register web_fetch on the orchestrator (file_qa + web_fetch routing)"
```

---

### Task 4: CLI mounts both servers

**Files:**
- Modify: `src/cli/chat.ts`
- Test: (none new — covered by `run-chat` tests + the live test in Task 5; verified by typecheck/lint/full-suite)

**Interfaces:**
- Consumes: `createFileTools`, `createFetchTools` (`src/mcp/client.ts`), `createSuperAgent(fileQaTools, fetchTools)` (`agents/super.ts`), the existing resource + `runChat` wiring.
- Produces: a CLI that mounts BOTH servers, builds the orchestrator over both specialists, and closes BOTH in `finally`.

- [ ] **Step 1: Read the current `src/cli/chat.ts`** so you preserve the resource/budget/warm/unload logic exactly, then change only the mounting + agent construction.

- [ ] **Step 2: Replace `src/cli/chat.ts`** with (full file):

```ts
import qwenFast from '../../models/qwen-fast.ts';
import { createSuperAgent } from '../../agents/super.ts';
import { ResourceError } from '../core/errors.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { estimateModelBytes } from '../resource/footprint.ts';
import { fitsBudget, machineBudgetBytes } from '../resource/hardware.ts';
import { isProjectStoreActive } from '../resource/model-store.ts';
import {
  isModelInstalled,
  pullModel,
  unloadModel,
  warmModel,
} from '../resource/ollama-control.ts';
import { runChat } from './run-chat.ts';

const FOOTPRINT = estimateModelBytes({
  paramsBillions: 8,
  bytesPerWeight: 0.56,
  contextTokens: qwenFast.params.numCtx ?? 8192,
  kvBytesPerToken: 131072,
});

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim();
  if (task.length === 0) {
    console.error('Usage: bun run src/cli/chat.ts "<your request>"');
    process.exit(1);
  }

  const budget = machineBudgetBytes();
  if (!fitsBudget(FOOTPRINT, budget)) {
    throw new ResourceError(
      `${qwenFast.model} (~${Math.round(FOOTPRINT / 1e9)}GB) exceeds the GPU budget (~${Math.round(budget / 1e9)}GB)`,
    );
  }

  if (!(await isModelInstalled(qwenFast.model))) {
    console.error(`Pulling ${qwenFast.model} (first run only)...`);
    await pullModel(qwenFast.model);
  }
  await warmModel(qwenFast.model);
  console.error(
    isProjectStoreActive()
      ? 'Using project-local models from ./model-images'
      : '⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project\'s local models.',
  );

  const fileServer = await createFileTools();
  const fetchServer = await createFetchTools();
  try {
    const orchestrator = createSuperAgent(fileServer.tools, fetchServer.tools);
    const result = await runChat({
      orchestrator,
      task,
      runsRoot: 'runs',
      runId: `run-${process.pid}`,
    });
    console.log(result.kind === 'answer' ? result.text : result.message);
  } finally {
    await fileServer.close();
    await fetchServer.close();
    await unloadModel(qwenFast.model);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck, lint, full suite**

Run: `bun run typecheck && bun run lint && bun test`
Expected: typecheck 0; lint 0 (only the biome.json NOTICE); all tests pass (the mock/unit suite needs no uvx).

- [ ] **Step 4: Commit**

```bash
git add src/cli/chat.ts
git commit -m "feat(cli): mount file + fetch MCP servers; route across both specialists"
```

---

### Task 5: Opt-in live integration tests (uvx fetch + live orchestrator)

**Files:**
- Create: `tests/integration/uvx-available.ts`
- Create: `tests/integration/fetch-mount.live.test.ts`
- Create: `tests/integration/orchestrator-web.live.test.ts`

**Interfaces:**
- Consumes: `mountMcpServer`, `createFileTools`, `createFetchTools` (`src/mcp/client.ts`); `createSuperAgent` (`agents/super.ts`); `runOrchestrator` (`src/core/orchestrator.ts`); `ollamaReady` (`tests/integration/ollama-available.ts`); `warmModel`, `unloadModel` (`src/resource/ollama-control.ts`).
- Produces: `uvxReady(): Promise<boolean>` (true iff `uvx mcp-server-fetch --help` exits 0 within a timeout). Two `describe.skipIf`-gated live test files. `bun test` stays green when uvx/Ollama/network are absent.

- [ ] **Step 1: Create the probe** — `tests/integration/uvx-available.ts`

```ts
/** True iff `uvx mcp-server-fetch` can start (probes with --help, killed on timeout). */
export async function uvxReady(timeoutMs = 15000): Promise<boolean> {
  try {
    const proc = Bun.spawn(['uvx', 'mcp-server-fetch', '--help'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const code = await proc.exited;
    clearTimeout(timer);
    return code === 0;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Create the fetch-mount live test** — `tests/integration/fetch-mount.live.test.ts`

```ts
import { describe, expect, test } from 'bun:test';
import { createFetchTools } from '../../src/mcp/client.ts';
import { uvxReady } from './uvx-available.ts';

const ready = await uvxReady();

describe.skipIf(!ready)('live: uvx mcp-server-fetch mount', () => {
  test('exposes a fetch tool and retrieves a URL', async () => {
    const { tools, close } = await createFetchTools();
    try {
      expect(tools.fetch).toBeDefined();
      const result = await tools.fetch.execute?.(
        { url: 'https://example.com', max_length: 500 },
        {} as never,
      );
      expect(JSON.stringify(result).toLowerCase()).toContain('example');
    } finally {
      await close();
    }
  }, 60_000);
});
```

- [ ] **Step 3: Create the live orchestrator web test** — `tests/integration/orchestrator-web.live.test.ts`

```ts
import { afterAll, describe, expect, test } from 'bun:test';
import { createSuperAgent } from '../../agents/super.ts';
import { runOrchestrator } from '../../src/core/orchestrator.ts';
import { createFetchTools, createFileTools } from '../../src/mcp/client.ts';
import { unloadModel, warmModel } from '../../src/resource/ollama-control.ts';
import { ollamaReady } from './ollama-available.ts';
import { uvxReady } from './uvx-available.ts';

const MODEL = 'qwen3:8b';
const ready = (await uvxReady()) && (await ollamaReady(MODEL));

describe.skipIf(!ready)('live orchestrator: web routing (real Ollama + uvx)', () => {
  afterAll(async () => {
    await unloadModel(MODEL);
  });

  test('routes a URL request to web_fetch and answers', async () => {
    await warmModel(MODEL);
    const fileServer = await createFileTools();
    const fetchServer = await createFetchTools();
    try {
      const orch = createSuperAgent(fileServer.tools, fetchServer.tools);
      const result = await runOrchestrator(
        orch,
        'Summarize the page at https://example.com in one sentence.',
      );
      expect(result.kind).toBe('answer');
    } finally {
      await fileServer.close();
      await fetchServer.close();
    }
  }, 180_000);
});
```

- [ ] **Step 4: Run the suite (live blocks auto-skip without uvx/Ollama)**

Run: `bun test` then `bun run typecheck && bun run lint`
Expected: all tests pass; the two live blocks either run (if uvx + Ollama present) or skip — `bun test` stays green either way. typecheck + lint clean.

- [ ] **Step 5: (Optional) manual live confirmation**

```bash
# Terminal 1 (quit the menu-bar Ollama first):
bun run serve
# Terminal 2:
bun test ./tests/integration/fetch-mount.live.test.ts ./tests/integration/orchestrator-web.live.test.ts
```
Expected: fetch-mount test fetches example.com; orchestrator test routes the URL to web_fetch and returns `kind:'answer'`. (First run downloads `mcp-server-fetch` via uvx.)

- [ ] **Step 6: Commit**

```bash
git add tests/integration/uvx-available.ts tests/integration/fetch-mount.live.test.ts tests/integration/orchestrator-web.live.test.ts
git commit -m "test(integration): opt-in live tests for fetch mount + web routing (auto-skip)"
```

---

## Self-Review

**1. Spec coverage:**
- `mountMcpServer({command,args,env?})` primitive → Task 1. ✓
- `createFileTools` preset unchanged + `createFetchTools` → Task 1. ✓
- `web_fetch` agent using the `fetch` tool → Task 2. ✓
- Register `web_fetch` beside `file_qa` on the orchestrator → Task 3. ✓
- CLI mounts both servers, closes both in finally → Task 4. ✓
- Tests: mount genericity (Task 1), web_fetch agent-def (Task 2), 2-specialist routing mock (Task 3), opt-in live fetch-mount + live orchestrator web (Task 5). ✓
- `bun test` green without uvx/Ollama; typecheck + lint clean → every task's verify step. ✓
- Deferred (declarative mount registry, agent-builder, response-format) → correctly absent. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every run step has the command + expected result.

**3. Type consistency:** `McpServerSpec`/`MountedServer` (Task 1) consumed by Task 4's CLI and Task 5's tests. `createSuperAgent(fileQaTools, fetchTools)` new 2-arg signature (Task 3) is matched by the Task 4 CLI call and the Task 5 live test. `createWebFetchAgent(tools)` (Task 2) consumed by `super.ts` (Task 3). Tool key `fetch` (un-prefixed, verified) used in the web_fetch agent prompt + the live tests. `uvxReady()` (Task 5) mirrors the existing `ollamaReady()`. Mock helpers `subAgent`/`orchModel` reused from the existing orchestrator test (Task 3 Step 5).

**One carried note:** Task 4 makes `uvx` a prerequisite for the *real* CLI (the fetch agent needs it). This is intentional and documented in Global Constraints; graceful degradation when uvx is absent is deferred (a declarative mount registry slice). The mock/unit suite remains uvx-free.
