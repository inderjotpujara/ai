# Task 5 Report — Tool telemetry + CLI wiring (chat/flow/crew) + default `mcp.json` (Slice 15)

**Status:** DONE
**Branch:** `slice-15-mcp-mounts`
**Commit:** `ba51662` — `feat(mcp): registry-driven CLI mounts + workflow.tool/mcp.mount telemetry + default mcp.json (Slice 15 Task 5)`

## What was done (brief steps, in order)

1. **Failing span test** — created `tests/mcp/tool-span.test.ts` exactly per the brief (3 tests: result pass-through, error propagation, mount-recorder handoff). Verified FAIL first (`Export named 'withMcpMountSpan' not found`).
2. **`src/telemetry/spans.ts`** — added 5 `ATTR` keys after `PROVISION_SNAPSHOT_FALLBACK` (`TOOL_NAME` = `gen_ai.tool.name`, `MCP_SERVER`, `MCP_TRANSPORT`, `MCP_TOOL_COUNT`, `MCP_MOUNT_OUTCOME`) plus `withToolSpan` (span `workflow.tool`) and `withMcpMountSpan` (span `mcp.mount`, per-server `mcp.server.mount` events, recorded-server count set on the span at the end). Test now PASSES (3/3).
3. **`src/workflow/run-step.ts`** — wrapped both `callTool` call sites (`runLeaf` and `runStepByKind` `case StepKind.Tool`) in `withToolSpan` with unchanged dispatch semantics: same args, same callIds (`callId` / `step.id`), same unknown-tool `WorkflowError` paths (throw in runLeaf, `Promise.reject` in runStepByKind — both *before* the span opens, unchanged). `bun test tests/workflow/` → 21 pass, 0 fail, suite unmodified.
4. **`mcp.json` (repo root, committed)** — exactly today's two mounts: `file-tools` (`bun run src/mcp/server.ts`, agents `["file_qa"]`) and `fetch` (`uvx mcp-server-fetch`, agents `["web_fetch"]`). Behavior-preserving default. `.mcp-approvals.json` remains gitignored (verified).
5. **`src/cli/flow.ts`** — swapped `createFetchTools, createFileTools` import for `loadMcpConfig` + `mountAll`/`warnUnknownAgents` + `withMcpMountSpan`. Mount region replaced per the brief: `reg = await withMcpMountSpan(mountAll + record mounted/skipped/dormant)`; `tools = reg.merged`; agents built from `reg.forAgent('file_qa')` / `reg.forAgent('web_fetch')`; `warnUnknownAgents(config, Object.keys(agents), console.error)` added. Inner body (selection runtime, verifyRuntime + `store.close()`/`manager.unloadAll()` finally, outcome handling, exit codes) identical apart from one indent level; outer finally is now `await reg.close()`.
6. **`src/cli/crew.ts`** — same envelope swap; `tools = reg.merged` (crew members without per-member tools fall back to the merged set via `buildCrewAgent` — unchanged behavior). Selection/verify/`runCrewCli`/outcome body preserved; outer finally `await reg.close()`. (`warnUnknownAgents` not wired here — crew has no fixed agent map; the brief only wires it in flow.ts.)
7. **`src/cli/chat.ts`** — same envelope swap; `createSuperAgent(reg.forAgent('file_qa'), reg.forAgent('web_fetch'), onBeforeDelegate)` — signature unchanged. `maybeAutoProvision()`, model-manager warmup, notice/notify block, registry/select-hook all untouched. Outer finally preserves order: `await reg.close(); await manager.unloadAll();`.
8. **Formatting** — `biome check --write` on the touched files fixed 3 formatting nits the brief's inline code introduced (long param/expect lines).

## Gate results

- `bun run docs:check` → ✔ (no new src subsystem; living docs intact)
- `bun run typecheck` → clean
- `bun run lint` → my files clean; **3 pre-existing errors + 8 warnings remain in files untouched by this task** (`tests/mcp/pack.test.ts` import-sort/format from an earlier task; `noTemplateCurlyInString`/`noExplicitAny`/unused-var warnings in pack/provisioning/snapshot-source/ollama-control tests). Verified via `git status`: none of those files are in my diff.
- `bun test` (full, 200.8s) → **416 pass, 2 skip, 0 fail, 418 tests / 125 files** — includes the 3 new tool-span tests; no pre-existing count dropped.

## Self-review notes

- All three CLI finally-structures re-read post-edit and verified against the brief: try-nesting depth reduced by one (two servers → one registry), every inner finally (verifyRuntime store/manager, selection.close, chat's manager.unloadAll) preserved verbatim and in order.
- `ATTR.MCP_TRANSPORT` is added but not yet emitted anywhere — the brief specifies the key now while mount events carry server/outcome/toolCount; flagging so the final review doesn't count it as drift.
- `withMcpMountSpan` sets `ATTR.MCP_TOOL_COUNT` on the root span to the number of *recorded servers* (mounted+skipped+dormant), while the same key on per-server events means tool count — slightly overloaded semantics, but exactly per the brief's spec'd code.
- `createFileTools`/`createFetchTools` in `src/mcp/client.ts` now have no src/ callers (tests still exercise the client module). Left in place — removal wasn't in scope.
- Consent note (brief Step 10): the committed defaults are NOT pre-approved; first interactive run prompts once per server (persisted to `.mcp-approvals.json`); non-TTY runs skip with a warning (`AGENT_MCP_AUTO_APPROVE=1` bypasses). Test suite unaffected (tests construct deps directly).
