# Slice 15 — Declarative `mcp.json` mount registry + starter integration pack (design)

**Date:** 2026-07-02
**Phase:** C — "Connect it" (recommended-sequence item 8)
**Branch:** `slice-15-mcp-mounts`
**Status:** spec — awaiting user review before writing the implementation plan

## 1. Problem & goal

Slice 3 gave us the mount primitive — `mountMcpServer({command,args})` → `{tools, close}` —
but every mount is **hardcoded**: `createFileTools()`/`createFetchTools()` are called inline
in `chat.ts`, `flow.ts`, and `crew.ts`, and the agent↔server mapping (file-qa gets
file-tools, web-fetch gets fetch) lives in code. Adding a capability means editing three
CLIs. The Slice-3 plan explicitly deferred "declarative mount registry" — this slice is
that follow-on.

**Goal:** a declarative `mcp.json` registry — *list servers + which agents get them, loaded
at startup* — plus a curated **starter pack** of 2026-real MCP servers, so the platform can
actually *do* things across domains ("power comes from tools, not the agent shell") and so
the Phase-D agent-builder has a capability-tagged **palette of servers to suggest** on
`report_capability_gap`.

## 2. Scope decision (locked with user)

- **In:** mount registry + starter pack. **Out:** the third Phase-C item (opt-in Codex
  cloud-backup delegate) — architecturally unrelated (cloud agent, not a tool mount), gets
  its own slice.
- **Transports:** stdio + **Streamable HTTP with static headers** (e.g. a PAT for GitHub's
  remote server). OAuth flows deferred — they need their own UX design.
- **Starter pack:** generous — keyless official core + keyed remote entries (dormant until
  the key env var is set) + an in-repo `bun:sqlite` server (the official SQL servers were
  archived in 2025 with no successor) + playwright-mcp for browser automation. The
  roadmap's "shell" entry is **deferred** (no maintained official server; arbitrary command
  execution needs its own sandboxing design), recorded, not dropped.
- **Security posture:** consent-on-mount **+ tool-definition pinning** (rug-pull defense) —
  the 2025-11-25 MCP spec makes consent-on-mount normative for one-click configs.
- **Attach model:** optional per-server `"agents": [...]` allowlist; omitted = all agents.
  Chosen over everything-for-everyone because undifferentiated ~40-tool prompts measurably
  hurt tool-choice accuracy on 7–14B local models — this framework's entire premise.
  Workflow tool-steps always see the full merged set (they dispatch by exact name; no model
  chooses).
- **Approval store:** `.mcp-approvals.json`, **untracked** (machine-local trust store —
  approvals on one machine must not auto-trust servers on another; per the
  "data stores are different — ask" rule, asked and locked with user).

## 3. Validated against the 2026 ecosystem (research summary)

Web-validated 2026-07-02 (full findings in the `reference-mcp-client-findings` memory):

- **MCP is stable in AI SDK v6**: `createMCPClient` lives in `@ai-sdk/mcp` (already a
  dependency, `^1.0.56`; v6 line = `1.0.57`). No `experimental_` prefix. Supports stdio,
  Streamable HTTP (recommended), SSE (legacy), and official-SDK transport interop. Known
  limits: no session management, no notifications (`list_changed`), no sampling/roots.
- **`mcp.json` de-facto convention** (Claude Code / Cursor / Claude Desktop): `mcpServers`
  root; stdio `command/args/env`; remote `type/url/headers`; `${VAR}` and `${VAR:-default}`
  expansion. VS Code alone uses a `servers` root — tolerated on import.
- **Official servers repo pruned in 2025**: only filesystem, memory, sequential-thinking,
  everything, fetch, git, time remain maintained. SQLite/Postgres/Brave/Puppeteer/GitHub
  archived — Playwright-MCP (Microsoft) replaces Puppeteer; GitHub moved to its own remote
  Streamable-HTTP server (`https://api.githubcopilot.com/mcp/`); Brave ships its own
  `@brave/brave-search-mcp-server`. Any config emitting archived
  `@modelcontextprotocol/server-postgres`-style strings is stale.
- **Consent-on-mount is normative** (spec 2025-11-25 security best practices): show the
  exact untruncated command, require explicit approval, highlight dangerous patterns.
  OWASP's top client mitigation: pin tool definitions, alert on drift.
- **Timing caveat:** spec 2026-07-28 (stateless core, TS SDK v2) lands in ~4 weeks.
  Building on SDK 1.29 / spec 2025-11-25 is safe; roots/sampling/notifications enter
  deprecation — we avoid them (deferred list).

## 4. The `mcp.json` format

Committed **`mcp.json` at the repo root**; `AGENT_MCP_CONFIG` env var overrides the path
(fallback-only, per convention). Standard `mcpServers` root — any ecosystem config pastes
in — plus exactly one extension field, `agents`:

```jsonc
{
  "mcpServers": {
    "file-tools": {
      "command": "bun", "args": ["run", "src/mcp/server.ts"],
      "agents": ["file-qa"]                    // extension: omit = available to all agents
    },
    "fetch": { "command": "uvx", "args": ["mcp-server-fetch"], "agents": ["web-fetch"] },
    "github": {
      "type": "http", "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_PAT}" }
    }
  }
}
```

- Entry shape: discriminated union — stdio (`command` required; `args?`, `env?`) | http
  (`type:"http"`, `url` required; `headers?`). Shared: `agents?: string[]`.
- `${VAR}` / `${VAR:-default}` expansion in `command`, `args`, `env`, `url`, `headers`.
- An entry referencing an **unset env var with no default is skipped as "dormant"** with a
  visible "inactive until GITHUB_PAT is set"-style notice — how keyed pack entries ship
  present-but-inert.
- Validation: **zod** (already a dep; used for I/O schemas elsewhere — extending it to this
  one user-authored config file is deliberate: a typo'd server must produce a helpful error,
  not vanish). **Per-entry degrade:** a malformed entry warns loudly and is skipped; valid
  entries still mount. Missing/corrupt file → warn + mount nothing (never crash).
- Import tolerance: a `servers` root (VS Code style) is accepted with a notice.
- The **committed default `mcp.json` contains exactly today's two mounts**
  (file-tools→file-qa, fetch→web-fetch), so behavior on main is unchanged until entries are
  added.

## 5. Starter pack (the Phase-D palette)

A typed committed catalog in `pack.ts` — `STARTER_PACK: PackEntry[]`, each entry carrying
`capabilities: string[]` tags (`files`, `sql`, `web-search`, `browser`, `vcs`, `memory`,
`reasoning`, `time`, `http`) plus `requiresEnv?: string[]` and a one-line description.
Enumerable by capability (`packByCapability()`) — the palette the agent-builder queries.

| Entry | Invocation | Keyless? | Capabilities |
|---|---|---|---|
| file-tools (in-repo) | `bun run src/mcp/server.ts` | ✅ | files |
| **sqlite (in-repo, NEW)** | `bun run src/mcp/sqlite-server.ts` (`bun:sqlite`, zero deps) | ✅ | sql |
| filesystem | `npx -y @modelcontextprotocol/server-filesystem <dirs>` | ✅ | files |
| memory | `npx -y @modelcontextprotocol/server-memory` | ✅ | memory |
| sequential-thinking | `npx -y @modelcontextprotocol/server-sequential-thinking` | ✅ | reasoning |
| fetch | `uvx mcp-server-fetch` | ✅ | http |
| git | `uvx mcp-server-git` | ✅ | vcs |
| time | `uvx mcp-server-time` | ✅ | time |
| playwright | `npx @playwright/mcp@latest` | ✅ (pulls browsers) | browser |
| github (remote HTTP) | `https://api.githubcopilot.com/mcp/` | 🔑 `GITHUB_PAT` | vcs |
| brave-search | `npx -y @brave/brave-search-mcp-server` | 🔑 `BRAVE_API_KEY` | web-search |
| exa-search | `npx -y exa-mcp-server` | 🔑 `EXA_API_KEY` | web-search |

CLI: `bun run mcp` → `list` (pack + mount/dormant status), `add <name>` (copies a pack
entry into `mcp.json` — atomic temp+rename write), `status` (what's mounted, per-agent
attach map). Note: playwright-mcp here is a *framework agent tool*, distinct from the
user-level "Claude Code uses native Chrome" rule (which governs Claude's own browser use).

## 6. Consent & security (spec-compliant + rug-pull-resistant)

- **Spec hash:** stable hash of `command+args+env keys` (stdio) or `url+header names`
  (http). Header/env **values are never hashed or stored** — no secrets in the trust store.
- **First mount** (unknown spec hash): TTY prompt (reusing Slice-14's dep-free prompt UI)
  showing the exact untruncated command/URL, with dangerous-pattern highlighting (`sudo`,
  `rm`, `curl|sh`, writes outside repo). Approve → record. Decline → skip, remembered as
  declined (re-prompted only when the spec changes).
- **Definition pinning:** after `client.tools()` resolves, hash the tool definitions (names
  + descriptions + input schemas) and pin to the approval. A later mount with a changed
  definition hash → loud warning + re-consent (the rug-pull defense; also why we don't
  honor `list_changed`).
- **Non-TTY** (tests, cron, pipes): unapproved entries are **skipped with a warning, never
  a hang** — mirrors Slice-14's TTY-gated provisioning hook.
- Store: `.mcp-approvals.json` (untracked, gitignored) —
  `{ [serverName]: { specHash, toolsHash, approvedAt } }`, atomic temp+rename writes.

## 7. Module layout & data flow

All inside the existing `src/mcp/` subsystem (no new top-level `src/<dir>` — `docs:check`
surface unchanged; architecture.md still gains its section + diagram edges, §10):

```
src/mcp/
  types.ts          McpServerEntry (stdio|http union), McpConfig, PackEntry, zod schemas
  config.ts         loadMcpConfig(path?) → { entries, dormant, warnings } (expansion + per-entry degrade)
  pack.ts           STARTER_PACK · packByCapability() · getPackEntry(name)
  consent.ts        approval store + spec/tools hashing + prompt flow
  mount.ts          mountAll(config, consent) → { forAgent(name), merged, close() } · stdio + HTTP
  client.ts         existing primitive — gains the Streamable-HTTP branch; presets become pack entries
  server.ts         existing file-tools server (unchanged)
  sqlite-server.ts  NEW zero-dep bun:sqlite MCP server (query/execute/schema tools, path-scoped)
src/cli/mcp.ts      `bun run mcp` — list · add <name> · status
```

**Startup flow** (identical in `chat.ts` / `flow.ts` / `crew.ts`, replacing the hardcoded
mount blocks): `loadMcpConfig()` → print warnings/dormant once → consent gate per entry →
mount approved entries (stdio via `StdioMCPTransport`, http via the AI SDK's
`type:'http'` transport) → pin definitions → return
`{ forAgent, merged, close }`. Agent factories receive `forAgent('file-qa')` (their scoped
slice); workflow `deps.tools` and crew fallback tools receive `merged`; one aggregate
best-effort `close()` in a single `finally` replaces the nested stacks.

**Attach resolution:** entry without `agents` → in every agent's slice and `merged`; with
`agents` → only those agents' slices (still in `merged` for tool-steps). Unknown agent
names in an `agents` list → warning (typo guard), entry still mounts for valid names.

## 8. Error handling (degrade-never-crash, never silent)

- Malformed entry → loud per-entry warning; others mount.
- Mount failure (missing binary, network refused, server boot crash) → warning naming
  server + cause; remaining servers unaffected; agents run with fewer tools; a workflow
  tool-step naming an absent tool keeps the explicit `WorkflowError('unknown tool: …')`.
- Tool execution errors keep the house convention: surfaced as tool results, not throws.
- `close()` aggregates per-server failures; never throws.

## 9. Telemetry to emit (standing rule)

- **New `withToolSpan`** in `src/telemetry/spans.ts` wrapping engine-level `callTool` in
  `run-step.ts` (`workflow.tool` span) — closes the existing gap where `StepKind.Tool`
  runs with no span and no instrumentation. Attrs: `gen_ai.tool.name`, `mcp.server`,
  `mcp.transport`, duration, error flag.
- **`mcp.mount` span** per startup with per-server child events: `mounted` (tool count,
  duration), `dormant` (missing env key), `consent-declined`, `drift-detected`,
  `mount-failed`. New `ATTR.*` keys: `mcp.server`, `mcp.transport`, `mcp.tool.count`,
  `mcp.consent.outcome`.
- Flows through the existing `SpanExporter` seam → JSONL run-viewer + any OTLP backend.

## 10. Architecture-doc update (standing rule)

`docs/architecture.md` gains a **§14 "MCP mount registry & starter pack"** section (Slice
15; On-disk/Testing/Glossary renumber): the `src/mcp/` module map, the config→consent→
mount→attach flow, the pinning model, and the pack-as-palette role for Phase D. Both
Mermaid diagrams updated: module map — `mcp.json` + registry nodes join the
**Declarations** subgraph peers (`agents/*`, `models/*`, `workflows/*`, `crews/*`), CLI
mount edges reroute through `mount.ts`; data-flow — line "buildRegistry() + mount MCP
tools" becomes the config-loader/consent step. Glossary "Mounting an MCP server" entry
updated (presets → pack). README + ROADMAP + snapshot Artifact per the four-surface hard
line.

## 11. Testing & live-verify plan

- **Unit:** config loader (fixtures: malformed entries, expansion incl. `${VAR:-default}`,
  dormant detection, `servers`-root tolerance), consent store (spec hash stability, drift
  → re-prompt, non-TTY skip), attach resolution (scoped slices, merged set, unknown-agent
  warning), pack lookups.
- **Real round-trips, no network:** stdio mounts against both in-repo servers (file-tools,
  sqlite); **HTTP mount against an in-process `McpServer` served over the official SDK's
  Streamable HTTP transport** inside the test — a genuinely real HTTP mount.
- **In-repo eval** (mirrors Slice-14's fit eval): tool-choice accuracy, scoped `ToolSet`
  vs full merged set, on the live local model — the evidence for the attach-model choice.
  Auto-skips when Ollama is down (house pattern).
- **Live-verify before merge (standing gate):** real `bun run mcp add` + mounts of
  `npx`/`uvx` pack servers on the dev machine; `bun run flow`/`crew` end-to-end through
  the registry; GitHub remote HTTP live-verified only if a PAT is present, else
  logged-deferred.

## 12. Deferred — explicitly what we're leaving (recorded in ROADMAP too)

Nothing here is silently dropped; each is a conscious follow-on:

1. **Codex heavy-lifting backup** (Phase C item 3) — own slice; cloud-delegation consent +
   cost design deserves its own spec.
2. **OAuth for remote servers** — the AI SDK client supports `authProvider` (PKCE, refresh);
   the browser-flow UX + token storage design is its own unit of work.
3. **Live official-registry query** (`registry.modelcontextprotocol.io`) — API frozen at
   v0.1, GA pending; curation is the pack's value today. Revisit when GA.
4. **Shell server** — arbitrary command execution needs a sandboxing design; no maintained
   official server exists.
5. **`list_changed` / notifications** — unsupported by the AI SDK client and a rug-pull
   vector; pinning + restart is the deliberate posture.
6. **Roots / sampling** — entering 12-month deprecation in spec 2026-07-28; do not build.
7. **Spec-2026-07-28 / TS-SDK-v2 migration** — stateless core lands ~4 weeks after this
   slice; a small follow-on once the SDK v2 is stable.

## 13. Task phasing (for the plan)

1. Types + config loader (zod schemas, expansion, per-entry degrade) — pure, heavily tested.
2. Consent store + hashing + prompt flow.
3. Mounting (HTTP branch in client.ts, `mountAll`, attach resolution) + in-process
   round-trip tests.
4. `bun:sqlite` server + pack catalog + `bun run mcp` CLI.
5. CLI wiring (chat/flow/crew) + `withToolSpan`/`mcp.mount` telemetry + default `mcp.json`.
6. Eval + docs (all four surfaces) + ROADMAP deferrals + live-verify.

## 14. Standing notes

- **Docs (hard line):** all four living surfaces every slice — `architecture.md` (+ both
  Mermaid diagrams), root `README.md`, `docs/ROADMAP.md`, the interactive snapshot
  Artifact — plus the SDD ledger `.superpowers/sdd/progress.md` as tasks complete.
- **Telemetry: not optional** — §9 ships with the slice, not after.
- **No new npm dependencies** (Slice-13/14 precedent): `@ai-sdk/mcp`,
  `@modelcontextprotocol/sdk`, `zod` are already present; sqlite via `bun:sqlite`.
- **No hardcoding:** paths/keys via config + `AGENT_*` env fallbacks only.
- **Consent before acquire** — extended from model pulls (Slice 14) to server mounts.
- **Live-verify before merge** — §11's gate, mock/contract tests don't count.
