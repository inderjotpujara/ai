# Task 3 report: HTTP transport + `mountAll` with attach resolution

**Status:** Done. Commit `8b9662b` on branch `slice-15-mcp-mounts`.

## What shipped

1. **`src/mcp/client.ts`** — extended `mountMcpServer` to accept `McpMountSpec =
   McpServerSpec | McpHttpSpec`. HTTP branch builds `{ type: 'http', url, headers }`
   and passes it straight through to `@ai-sdk/mcp`'s `createMCPClient({ transport })`;
   stdio branch unchanged (still `new StdioMCPTransport(spec)`). Discriminated via
   `'url' in spec`.
2. **`tests/mcp/mount-http.test.ts`** — real in-process Streamable-HTTP MCP server
   (official `@modelcontextprotocol/sdk` `McpServer` + `StreamableHTTPServerTransport`,
   stateless mode `sessionIdGenerator: undefined`, fresh server+transport per request)
   on an ephemeral `127.0.0.1` port. `mountMcpServer({ type: 'http', url })` mounts it
   over real HTTP and sees the `ping` tool. No mocks, no external services.
3. **`src/mcp/mount.ts`** (new) — `mountAll(config, deps)` registry:
   - Per-entry pipeline: `ensureConsent` → `mount(toSpec(entry))` → `toolsHash` +
     `checkDrift` (re-approve or skip) → `pinTools` → accumulate into `merged`/`forAgent`.
   - **Degrade-never-crash**: every entry is wrapped in its own try/catch. A malformed
     `raw` config that makes `ensureConsent` throw (via `specHash`'s throw path) is
     caught and treated exactly like a mount failure — warn + skip + continue, never
     propagates and never blocks the remaining entries. A `mount()` throw is likewise
     caught per-entry.
   - `writeApprovals` is wrapped separately so a persistence failure warns but doesn't
     drop already-mounted servers.
   - `forAgent(name)` slices by `entry.agents`: unscoped entries appear for every
     agent; scoped entries only for agents in their list.
   - Tool-name collisions across servers: later server wins, a warning is emitted
     (documented in the merge loop, exercised by test 1's `t_shared` collision).
   - `warnUnknownAgents` — typo guard for `agents` lists naming an agent not in the
     caller's known-agents list.
4. **`tests/mcp/mount-all.test.ts`** (new) — 7 tests (fake `mount` fn, no real
   processes): merge + collision, agent-scoped slicing, mount-failure degrade,
   declined-consent skip, tool pinning + approvals persistence, drift-triggers-skip
   under non-interactive consent, and `warnUnknownAgents`' typo warning.

## Deviations from the brief (and why)

- **`ensureConsent` call wrapped in its own try/catch**, per the task instructions
  (not literally present in the brief's Step 6 code block, which called
  `await ensureConsent(entry, consent)` unguarded). `specHash`/`describeEntry` in
  `consent.ts` throw on malformed `raw` (missing `command`/`url`), and `ensureConsent`
  calls `specHash` first thing — so an unguarded call would let one bad entry's
  config crash the whole `mountAll` loop, violating the degrade-never-crash
  invariant. Added:
  ```ts
  let ok: boolean;
  try {
    ok = await ensureConsent(entry, consent);
  } catch (cause) {
    warn(`MCP server "${entry.name}" has a malformed config: ${(cause as Error).message}`);
    skipped.push({ name: entry.name, reason: (cause as Error).message });
    continue;
  }
  ```
  No test in the brief exercises this path directly (all `mount-all.test.ts` entries
  have well-formed `raw`), so it's defensive coverage beyond the brief's explicit
  test list — flagging in case a future task wants a dedicated malformed-raw test.
- **`tests/mcp/mount-all.test.ts`'s `fakeServer` cast**: the brief's
  `as MountedServer['tools']` cast on a tool object missing `inputSchema` fails
  `tsc --noEmit` (bun's test runner strips types and doesn't catch this, but
  `bun run typecheck` does — it's a real gate here). Fixed with
  `as unknown as MountedServer['tools']` per TypeScript's own suggested fix; no
  behavior change, purely a type-erasure widening for the fake test double.
- **Biome auto-format/import-order**: ran `bunx biome check --write` on all four
  touched files after `bun run lint:file` flagged import-sort and line-wrap issues
  (cosmetic only — e.g. `type ConsentDeps` alphabetized after `approvalsPath`,
  long template-literal `warn(...)` calls wrapped). No logic changes.

No other deviations — `client.ts` and `mount.ts` match the brief's code verbatim
otherwise; both new SDKs (`@ai-sdk/mcp@1.0.56`, `@modelcontextprotocol/sdk@1.29.0`)
were already installed and the HTTP round-trip test passed on the first run with
no transport-shape adjustments needed.

## Verification

```
bun test tests/mcp/mount-all.test.ts tests/mcp/mount-http.test.ts tests/mcp/mount.test.ts
→ 9 pass, 0 fail, 15 expect() calls

bun test tests/mcp/            (full subsystem regression)
→ 38 pass, 0 fail, 70 expect() calls

bun run typecheck              → clean
bun run lint:file -- src/mcp/client.ts src/mcp/mount.ts tests/mcp/mount-all.test.ts tests/mcp/mount-http.test.ts
→ clean (post biome --write)
```

Pre-commit hook (`bun run scripts/docs-check.ts`) passed: no new `src/` subsystem
was added (mount.ts lives in the already-documented `src/mcp/` subsystem), so no
`docs/architecture.md` update was required for this task's scope. That said, the
brief describes Task 3 as adding meaningful new mount/consent-gate/attach-resolution
behavior to `src/mcp/` — worth flagging to whichever task/slice does the
slice-level docs pass (README/ROADMAP/architecture.md/SDD ledger) that `mountAll`,
`MountedRegistry`, HTTP transport support, and `warnUnknownAgents` are new
capabilities the architecture doc's `src/mcp/` section should describe once the
CLI-consuming task (Task 4+) lands and the full slice narrative is known.

## Files touched

- Modified: `/Users/inderjotsingh/ai/src/mcp/client.ts`
- Created: `/Users/inderjotsingh/ai/src/mcp/mount.ts`
- Created: `/Users/inderjotsingh/ai/tests/mcp/mount-http.test.ts`
- Created: `/Users/inderjotsingh/ai/tests/mcp/mount-all.test.ts`
- Left untouched (pre-existing unstaged changes from other tasks on this branch,
  not part of Task 3's scope): `.remember/now.md`, `.remember/today-2026-07-02.md`,
  `.superpowers/sdd/progress.md`, `.superpowers/sdd/task-1-brief.md`,
  `.superpowers/sdd/task-1-report.md`, `.superpowers/sdd/task-2-brief.md`,
  `.superpowers/sdd/task-2-report.md`, `.superpowers/sdd/task-3-brief.md`.

## Concerns for review

- The `mountAll`/malformed-raw try/catch path (see Deviations) has no direct unit
  test in this task's scope — it's a straightforward mirror of the existing
  mount-failure catch block, but a future task could add one entry with a raw
  config missing `command`/`url` to `mount-all.test.ts` for explicit coverage.
- Tool-name collision behavior (later server wins + warn) is only exercised
  incidentally by test 1's `t_shared` case; no test asserts the warning message
  itself, only the resulting `merged` shape.
