# Slice 3: Mount Any MCP Server + Web-Fetch Specialist — Design

**Date:** 2026-06-29
**Status:** Approved (design) — pending implementation plan
**Builds on:** Slice 2 (orchestrator / agents-as-tools / capability gap). Repo: `inderjotpujara/ai`, branch `slice-3-mcp-integration`.

## 1. Vision

This is the **integration-library** slice — the n8n moment. After it, *adding a
capability stops being "write tool code" and becomes "point at an MCP server
(`command` + `args`)."* We generalize our MCP wiring into a single
`mountMcpServer(spec)` primitive, then prove it by mounting a **keyless external
server** (`uvx mcp-server-fetch`) as a second specialist agent. The orchestrator
now routes among **two real specialists** — file-Q&A and web-fetch — or reports
a capability gap.

## 2. Scope

### In scope (Slice 3)
- **`mountMcpServer({ command, args?, env? })`** — connect to ANY stdio MCP server and return its `{ tools, close }`. The reusable integration primitive.
- Keep `createFileTools()` working (thin preset over `mountMcpServer`); add `createFetchTools()` preset for `uvx mcp-server-fetch`.
- **`web_fetch` agent** (`agents/web-fetch.ts`) — uses the mounted `fetch` tool to retrieve a URL and answer/summarize.
- Register `web_fetch` alongside `file_qa` in the orchestrator (`agents/super.ts`) — first multi-real-specialist routing.
- CLI (`chat.ts`) mounts BOTH servers, builds both agents, closes both in `finally`.
- Tests: `mountMcpServer` proven generic; `web_fetch` agent-def unit test; orchestrator mock routing test (URL→web_fetch, file→file_qa); opt-in auto-skipping integration tests for the real fetch server + a live orchestrator URL run.

### Out of scope — deferred (with their own future work)
- **Declarative mount registry** (an `mcp.json`-style config listing servers to mount): Slice 3 wires mounts in code; a config-driven registry is a later refinement.
- **Agent-builder** and **response-format tooling** (still deferred to their own brainstorms).
- Non-keyless / API-key MCP servers (search, SaaS) — excluded by the no-keys rule.
- A dynamic resource scheduler / model discovery (the *other* Slice-3 candidate from the original roadmap) — explicitly NOT this slice; this slice is the integrations path.

## 3. Architecture

The orchestrator backbone is unchanged. Slice 3 adds an **integration primitive**
and a second agent that consumes an external MCP server's tools.

```
src/mcp/
  client.ts   # MODIFY: add mountMcpServer({command,args,env}); createFileTools + createFetchTools become presets
  server.ts   # unchanged (our read_file server)
agents/
  web-fetch.ts # NEW: createWebFetchAgent(tools) — name 'web_fetch', uses the `fetch` tool
  super.ts     # MODIFY: register [file_qa, web_fetch] on the orchestrator
  file-qa.ts   # unchanged
src/cli/
  chat.ts      # MODIFY: mount both servers, build both agents, close both in finally
tests/
  mcp/mount.test.ts                       # NEW: mountMcpServer mounts our own server, exposes read_file (real subprocess)
  agents/web-fetch.test.ts                # NEW: web_fetch agent-def unit test (mock)
  core/orchestrator.test.ts               # MODIFY: add a 2-specialist routing test (mock)
  integration/uvx-available.ts            # NEW: uvxReady() probe
  integration/fetch-mount.live.test.ts    # NEW: mount uvx mcp-server-fetch → exposes `fetch` (+ fetch example.com); auto-skip
  integration/orchestrator-web.live.test.ts # NEW: live orchestrator "summarize <url>" → delegates to web_fetch; auto-skip (uvx + Ollama)
```

### 3.1 The mount primitive — `src/mcp/client.ts`
```
export type McpServerSpec = { command: string; args?: string[]; env?: Record<string, string> };

export async function mountMcpServer(spec: McpServerSpec): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  const client = await createMCPClient({ transport: new Experimental_StdioMCPTransport(spec) });
  const tools = await client.tools();
  return { tools, close: () => client.close() };
}

export function createFileTools()  { return mountMcpServer({ command: 'bun', args: ['run', 'src/mcp/server.ts'] }); }
export function createFetchTools() { return mountMcpServer({ command: 'uvx', args: ['mcp-server-fetch'] }); }
```
- Uses the SAME `@ai-sdk/mcp@^1` API we already run — no dependency bump.
- External tools come back **un-prefixed**: `uvx mcp-server-fetch` yields `{ fetch }`.
- `close()` terminates the subprocess (each mount is its own process).
- **Implementation caveat:** confirm the installed `@ai-sdk/mcp@^1` (1.0.55)
  `Experimental_StdioMCPTransport` config type accepts `env`. Our current
  `createFileTools` only passes `{ command, args }`. If `env` is not in the v1
  type, keep `env` in `McpServerSpec` (forward-compat) but pass only the fields
  the transport accepts — `env` is optional and unneeded for our file/fetch
  servers (PATH is inherited, so `uvx` resolves).

### 3.2 Web-fetch agent — `agents/web-fetch.ts`
```
createWebFetchAgent(tools: ToolSet): Agent
// name: 'web_fetch'
// description: 'Fetches a URL and answers questions about or summarizes the content of a web page.'
// model: createOllamaModel(qwenFast); systemPrompt instructs: use the `fetch` tool to get the URL, then answer concisely.
// tools: the mounted fetch toolset (contains `fetch`)
```

### 3.3 Orchestrator registration — `agents/super.ts`
`createSuperAgent(fileQaTools, fetchTools)` builds `file_qa` + `web_fetch` and
returns `createOrchestrator({ model, systemPrompt, agents: [fileQa, webFetch] })`.
The routing prompt (Slice 2's `buildRoutingPrompt`, already names concrete
`delegate_to_*` tools) now lists both specialists.

## 4. Data flow
```
CLI (chat.ts)
  -> mount read_file server (bun)  -> fileTools
  -> mount fetch server (uvx)      -> fetchTools
  -> createSuperAgent(fileTools, fetchTools)  [orchestrator over file_qa + web_fetch + gap]
  -> runOrchestrator(task)
       - "what's in /tmp/x.txt?"        -> delegate_to_file_qa  -> read_file -> answer
       - "summarize https://example.com"-> delegate_to_web_fetch -> fetch     -> answer
       - "book a flight"                -> report_capability_gap -> gap
  -> print answer/gap; journal; finally: close both MCP clients + unload model
```

## 5. Error handling
- Keyless throughout; the `fetch` server respects robots.txt by default and makes
  outbound HTTP only to the requested URL.
- A failed fetch (network/robots/timeout) returns as a tool result — the agent
  loop already feeds tool errors back to the model; no crash.
- Both MCP subprocesses are closed in the CLI's `finally` (even on throw).
- `mountMcpServer` surfaces a connect failure as a thrown error the CLI reports.

## 6. Testing strategy
- **Unit/mock (always run, no uvx/Ollama):**
  - `mountMcpServer` generality: mount our OWN server through it, assert `read_file` present (real subprocess, no network — proves the primitive isn't file-server-specific).
  - `web_fetch` agent-def: identity + injected tools (mock model).
  - Orchestrator routing with two specialists: mock model picks `delegate_to_web_fetch` for a URL task and `delegate_to_file_qa` for a file task; assert only the chosen one runs.
- **Opt-in integration (auto-skip via `uvxReady()` = `uvx mcp-server-fetch --version` succeeds):**
  - `fetch-mount.live`: mount `uvx mcp-server-fetch`, assert `fetch` tool exists; fetch `https://example.com` returns text (needs network; runs only when uvx present).
  - `orchestrator-web.live`: gated by uvx **and** Ollama (`ollamaReady`) — "summarize https://example.com" → `kind:'answer'`; auto-skips otherwise.
- `bun test` stays green on any machine (integration blocks skip when uvx/Ollama/network absent). `bun run typecheck` + `bun run lint` clean.

## 7. Definition of done
`mountMcpServer` mounts any stdio MCP server; the orchestrator routes a file
question to `file_qa` and a URL request to `web_fetch` (and reports a gap for
neither). Unit/mock suite green with no external deps; the opt-in live tests pass
when uvx + Ollama are present (verified manually at least once). `bun run
typecheck` + `bun run lint` clean.

## 8. Future seams recorded
- `mountMcpServer` → (future) a **declarative mount registry** (`mcp.json`): list servers + which agents get them, loaded at startup.
- Every future integration (GitHub, Postgres, Slack, …) is a new `create<X>Tools()` preset + an agent that holds those tools — no engine change.
