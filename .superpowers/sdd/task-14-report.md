### Task 14 (Slice 26): Wire `deps.authProviders` in `withMcpRun` — Report

**Status:** DONE, GREEN.

**Commit:** `91b86b6` — `feat(mcp): populate deps.authProviders for OAuth entries in withMcpRun`
(branch `slice-26-altruntime-remote-auth`, 2 files changed: `src/cli/with-mcp-run.ts`,
`tests/cli/with-mcp-run.test.ts`. Staged only these 2 files explicitly; verified via
`git status` before committing that no other repo-wide modified files — `.remember/*`,
`.superpowers/sdd/task-*-brief.md`, `docs/ROADMAP.md`, other in-flight tasks' edits —
were swept in. Pre-commit `docs-check` hook ran and passed.)

**What changed**

`src/cli/with-mcp-run.ts`:
- Added `buildAuthProviders(config: McpConfig): Record<string, OAuthClientProvider>` —
  iterates `config.entries`; for every entry where `entry.kind === McpTransportKind.Http`
  and `entry.auth?.kind === McpAuthKind.OAuth`, calls
  `createOAuthProvider(entry.name, { scopes: entry.auth.scopes, clientId: entry.auth.clientId })`
  and keys the result by `entry.name`. Non-OAuth and stdio entries are skipped — no
  provider built for them.
- In `withMcpRun`, before the existing `withMcpMountSpan`/`mountAll` call: builds
  `authProviders = { ...buildAuthProviders(config), ...opts.mountDeps?.authProviders }`
  (caller-supplied wins on key collision via spread order — auto-built spread first,
  caller's spread second) and calls `mountAll(config, { ...opts.mountDeps, authProviders })`.
- Ordering invariant (createRun → initRunTelemetry → mount) is unchanged: the
  authProviders map is built synchronously right before the existing `mountAll`
  call site inside the same `withMcpMountSpan` closure; nothing was reordered.

**TDD cycle**
- RED: added two tests to `tests/cli/with-mcp-run.test.ts` first (a shared
  `OAUTH_HTTP_CONFIG` with one Http entry, `auth: { kind: oauth, scopes: ['read'],
  clientId: 'cid' }`, and a spy `mount` injected via `mountDeps.mount`). Ran
  `bun test tests/cli/with-mcp-run.test.ts` → 1 fail: `received?.authProvider`
  was `undefined`, with the console warning
  `"MCP server \"oauth-server\" declares OAuth but no authProvider is registered —
  live OAuth is deferred; mounting without auth"` (mount.ts's existing degrade path
  firing, exactly the bug this task fixes).
- GREEN: implemented `buildAuthProviders` + the merge/pass-through in
  `withMcpRun`. Re-ran → both new tests pass.
- Second test asserts a caller-supplied `mountDeps.authProviders: { 'oauth-server':
  callerProvider }` wins: `spec.authProvider` is `toBe(callerProvider)`, not the
  auto-built one.
- No disk I/O concern: verified `createOAuthProvider`'s construction (in
  `src/mcp/oauth-provider.ts`) is side-effect-free — `tokenStorePath()` /
  `getServerAuth` / `setServerAuth` are only invoked inside methods like
  `tokens()`/`saveTokens()`/`redirectToAuthorization()`, never at construction
  time. The tests never call those methods on the auto-built provider, so
  nothing touches `~/.config/ai/mcp-tokens.json`.

**Verification run**
- `bun test tests/cli/with-mcp-run.test.ts tests/mcp/mount-all.test.ts` → 20 pass, 0 fail.
- `bun test tests/cli/ tests/mcp/` (full directories, regression check) → 153 pass, 0 fail.
- `bun run typecheck` → clean (`tsc --noEmit`, no errors).
- `bun run lint:file src/cli/with-mcp-run.ts tests/cli/with-mcp-run.test.ts` → clean
  (one biome import-order/format autofix applied to the test file via
  `bunx biome check --write`, then re-verified clean with `lint:file`).

**Self-review**
- Existing `withMcpRun` tests (ordering/span, close-after-body, stdio transport tag)
  all still pass unmodified — `buildAuthProviders` returns `{}` for configs with no
  OAuth entries, a no-op for every prior test's config (`EMPTY_CONFIG`,
  `ONE_SERVER_CONFIG`, both stdio-only).
- Static-header (non-OAuth) HTTP entries are unaffected: `buildAuthProviders` only
  inserts a key when `auth?.kind === McpAuthKind.OAuth`; `mount-all.test.ts`'s
  "static-key HTTP entry (no auth field) is unchanged" case still passes untouched.
- The ordering invariant documented in `withMcpRun`'s own comment
  (createRun → initRunTelemetry → mount) is preserved — the new code only adds a
  synchronous map-build step immediately before the pre-existing `mountAll` call.
- Scope respected per the brief's explicit boundary: this task only constructs and
  registers providers into the map. It does NOT drive the live browser-redirect
  handshake (SDK returning `'REDIRECT'`, calling `waitForRedirect()`, re-invoking
  `auth()`) — that is Task 18's concern.

**Concerns**
- None blocking. One structural note for whoever picks up Task 18 (live handshake
  orchestration): `withMcpRun` currently builds providers once, synchronously,
  before mount. If the live-handshake flow needs the redirect wait to happen
  concurrently with mount, or needs access to the run's telemetry span, it may
  need to reach back into this function or restructure how/when providers are
  built. Not a problem for Task 14's scope, but worth flagging since this task
  wasn't designed with that reuse in mind.
- This file previously held a report for a different, unrelated "Task 14" from
  an earlier slice (Slice 21, agent wall-clock timeout). That content is
  superseded by this report — see git history for the prior report if needed.
