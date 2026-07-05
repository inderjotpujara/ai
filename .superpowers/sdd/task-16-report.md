# Task 16 report — GitHub-PAT gated live-verify

## Status: DONE

## What was built

Created `tests/integration/github-mcp.live.test.ts`:

- Gate: `const HAS_PAT = !!process.env.GITHUB_PAT;` → `describe.skipIf(!HAS_PAT)('github mcp live-verify', ...)`.
- Inside the gated `test(...)` (120_000ms timeout):
  1. `mkdtemp` a scratch dir (`node:os` tmpdir + `node:fs/promises`).
  2. Writes a temp `mcp.json` containing only the `github` pack server:
     `{ mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PAT}' } } } }`
     (matches `src/mcp/pack.ts`'s `github` entry exactly).
  3. `loadMcpConfig(configPath)` — env expansion pulls the real `GITHUB_PAT` from `process.env` (default `env` param); asserts `config.dormant` is empty and `github` is in `config.entries`.
  4. `mountAll(config, { consent: { autoYes: true }, approvalsFile: <tmp path> })` — `autoYes` bypasses the TTY consent prompt (`ensureConsent` short-circuits on `deps.autoYes`, no hang); `approvalsFile` points into the same tmp dir so the run never touches the repo's real `.mcp-approvals.json`.
  5. Asserts `registry.mounted` includes `'github'`, `registry.skipped` is empty, and `Object.keys(registry.merged).length > 0` (≥1 tool exposed).
- `afterEach` closes the registry (`reg.close()`, swallowing errors) and `rm`s the tmp dir recursively — cleans up both the temp `mcp.json` and the temp approvals file; the repo's own `.mcp-approvals.json` is never referenced or mutated.

## Verification performed

- `bun test tests/integration/github-mcp.live.test.ts` **without** `GITHUB_PAT` → `0 pass, 1 skip, 0 fail`. Confirmed the describe block is skipped, not silently passing.
- `bun run typecheck` → clean (whole repo).
- `bun run lint:file tests/integration/github-mcp.live.test.ts` → clean after two fixes:
  - reordered the `mount.ts` import (`type MountedRegistry` before `mountAll`) per Biome's `organizeImports`.
  - added a `biome-ignore lint/suspicious/noTemplateCurlyInString` comment on the `Authorization: 'Bearer ${GITHUB_PAT}'` literal (same pattern already used in `src/mcp/pack.ts` for the same string — it's deliberately unexpanded at write-time, expanded later by `loadMcpConfig`).
- Re-ran the skip test after lint fixes to confirm still green.
- `git status` before commit confirmed no stray `.mcp-approvals.json` or other artifact was created by the (skipped) test run.

## Self-review

- **Gating correct**: `HAS_PAT` is a plain env check; `describe.skipIf` is the idiom already used in `tests/integration/reliability-live.test.ts` and `tests/integration/fetch-mount.live.test.ts`.
- **Shapes match real signatures**: verified against `src/mcp/config.ts` (`loadMcpConfig(path?, env?)`, default `env = process.env`) and `src/mcp/mount.ts` (`mountAll(config, deps): Promise<MountedRegistry>`, `MountAllDeps.consent?: Partial<ConsentDeps>`, `MountAllDeps.approvalsFile?: string`). No mocking of `mount` — a real network mount occurs when run with a PAT (Task 18's job).
- **No hang / no repo pollution**: `consent.autoYes: true` avoids the interactive TTY prompt path in `ensureConsent`; `approvalsFile` is redirected into the mkdtemp'd scratch dir, so a live run cannot write to the project's real `.mcp-approvals.json`. The scratch dir (config + approvals file) is removed in `afterEach` regardless of pass/fail.
- Only committed the new test file — left other in-flight, unrelated working-tree changes (other parallel tasks' briefs/reports/docs) untouched.

## Commit

`ab59b35` — `test(mcp): gated GitHub-PAT remote MCP live-verify` (branch `slice-26-altruntime-remote-auth`)

## Concerns

- None blocking. The brief's "Interfaces" line also mentions "a benign read tool call succeeds," but the concrete Step 1–2 scope (and the parent task instructions) only require proving the mount + ≥1 tool exposed here; actually invoking a GitHub tool is left to Task 18's live pass, where a real PAT is available to choose a safe read-only call (e.g. `get_me` or similar) without hardcoding assumptions about which tools the remote server currently exposes.

## Note

This overwrites a stale `task-16-report.md` from an earlier task-numbering pass (an unrelated "MCP tool-call breaker wrap" report) per the brief's "Overwrite stale report" instruction.
