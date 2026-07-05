### Task 18a (Slice 26, NEW — surfaced by live-verify): Wire the first-time OAuth
handshake completion into MCP mounting — Report

**Status:** DONE, GREEN.

**Problem:** `mountMcpServer` called `createMCPClient({ transport })` once and
returned/threw whatever came back. For a never-before-authorized OAuth server, the
`@ai-sdk/mcp` HTTP transport internally calls `auth()` with no authorization code,
which fires `provider.redirectToAuthorization(url)` (pops the browser) and then
returns `'REDIRECT'`, which the transport turns into a thrown `UnauthorizedError`.
There is no `transport.finishAuth` re-entry point — the code the user just approved
in the browser was captured by our loopback listener (`LiveOAuthClientProvider.
waitForRedirect()`) but nothing ever read it back, exchanged it, or retried the
mount. The mount silently failed/was skipped and no tokens were ever saved.

**Fix — `src/mcp/client.ts`:**

- Added `MountMcpServerDeps = { createClient?: typeof createMCPClient; authFn?:
  typeof auth }`, an optional second param on `mountMcpServer(spec, deps = {})`,
  defaulting to the real `@ai-sdk/mcp` exports. Purely additive — all existing
  single-arg call sites (`mount.ts`'s `deps.mount ?? mountMcpServer`, `createFileTools`,
  `createFetchTools`) are unaffected.
- New `connectMcpClient(spec, createClient, authFn)`:
  1. Builds the transport as before and calls `createClient({ transport })`.
  2. On error, only engages the handshake path if ALL of: the spec is HTTP (`'url' in
     spec`), `spec.authProvider` has a `waitForRedirect` method (our
     `LiveOAuthClientProvider`, via new `hasWaitForRedirect` type guard — a
     caller-supplied plain `OAuthClientProvider`, e.g. the contract-test stub, is left
     to throw untouched), and the error `isUnauthorizedError` (checks `instanceof
     UnauthorizedError` first, then falls back to `err?.constructor?.name ===
     'UnauthorizedError'` for a duplicate-module-instance edge case). Otherwise
     rethrows immediately — non-OAuth specs and already-authorized OAuth specs (valid
     tokens already in the store → no 401) are byte-for-byte unchanged, first-attempt
     path only.
  3. `await spec.authProvider.waitForRedirect()` → `{ code, state }` (the loopback
     listener already captured this from the browser hop that just happened inside
     step 1's `createClient` call).
  4. `await authFn(spec.authProvider, { serverUrl: new URL(spec.url),
     authorizationCode: code, callbackState: state })` — this is the SDK's exported
     `auth()`, which validates `state` against `storedState()`, exchanges the code for
     tokens, and calls `provider.saveTokens(...)` → our provider persists to the 0600
     token store (`token-store.ts`).
  5. Retries `createClient({ transport: buildHttpTransportConfig(spec) })` exactly
     ONCE with a freshly-built plain config object (not a stateful transport
     instance — `tokens()` now resolves from the just-saved store so the Authorization
     header is set). A second failure rethrows — no loop, no second browser hop.
- `mountMcpServer` now calls `connectMcpClient` instead of `createMCPClient` directly;
  `wrapToolsWithBreaker` on the returned tools is unchanged.
- Updated the `McpHttpSpec` docstring (was: "Contract-tested only — live token
  exchange is deferred… see docs/architecture.md §14") to describe the now-wired
  handshake completion, since that comment was stale relative to this fix. (Full
  `docs/architecture.md` prose update deferred to the slice's final docs pass, per
  this branch's observed pattern — no commit in `slice-26-altruntime-remote-auth` has
  touched `docs/architecture.md` yet; every task so far lands its own module diff and
  the docs pass happens once at slice landing.)

**Confirmed import shapes** (read directly off `node_modules/@ai-sdk/mcp/dist/
index.d.ts`, not assumed):
- `declare class UnauthorizedError extends Error { constructor(message?: string); }`
  — exported at top level (line ~204, re-exported in the barrel export at the bottom
  of the `.d.ts` alongside `auth`, `createMCPClient`, etc.).
- `declare function auth(provider: OAuthClientProvider, options: { serverUrl: string
  | URL; authorizationCode?: string; callbackState?: string; scope?: string;
  resourceMetadataUrl?: URL; fetchFn?: FetchFunction; }): Promise<AuthResult>` where
  `AuthResult = 'AUTHORIZED' | 'REDIRECT'`.
- Both importable as named exports: `import { auth, UnauthorizedError } from
  '@ai-sdk/mcp'` — no need for the constructor-name fallback in normal operation; it's
  kept purely as a defensive belt-and-suspenders check (see `isUnauthorizedError`).
- `createMCPClient(config: MCPClientConfig): Promise<MCPClient>` where
  `MCPClientConfig.transport: MCPTransportConfig | MCPTransport` — confirms
  `buildHttpTransportConfig`'s plain-object return value is a valid `transport` on
  every call, so rebuilding it fresh for the retry (rather than reusing a stateful
  transport instance) is correct and matches how the SDK expects to receive it.
- There is genuinely no `transport.finishAuth`/similar re-entry method on
  `MCPTransport` or `MCPClient` in the `.d.ts` — confirms the plan's premise that
  `auth()` is the only public re-entry point.

**Tests — `tests/mcp/client.test.ts`** (added; existing `buildHttpTransportConfig`
tests untouched):
1. `mountMcpServer` — first-time handshake: fake `createClient` throws
   `UnauthorizedError` on call 1, returns a fake client (`.tools()`/`.close()`) on
   call 2; fake `LiveOAuthClientProvider.waitForRedirect` resolves `{code:'C',
   state:'S'}`; fake `authFn` spy. Asserts `waitForRedirect` called once, `authFn`
   called once with `(provider, {authorizationCode:'C', callbackState:'S', ...})`,
   `createClient` called exactly twice, and the SECOND attempt's tools
   (`mounted.tools.search`) are what's returned.
2. Retry-still-fails path: `createClient` always throws `UnauthorizedError` →
   `mountMcpServer` rejects with `UnauthorizedError` (no infinite loop — `createClient`
   called exactly twice, `authFn` exactly once).
3. Non-OAuth spec (no `authProvider`): `createClient` called once, `authFn` never
   called, tools returned straight through.
4. Already-authorized OAuth spec (no error thrown on first `createClient` call):
   `createClient` called once, `waitForRedirect`/`authFn` never called — confirms the
   orchestration only engages on an actual `UnauthorizedError`, not merely "has an
   authProvider".

**Verification run inline:**
- `bun test tests/mcp/client.test.ts` → 6 pass, 0 fail, 20 expect() calls.
- `bun test tests/mcp/` (full subsystem, includes real stdio/HTTP round-trip tests
  unaffected by this change) → 91 pass, 0 fail, 237 expect() calls.
- `bun run typecheck` → clean.
- `bun run lint:file src/mcp/client.ts tests/mcp/client.test.ts` → `biome check`, no
  issues.

**Self-review:**
- Existing mount tests (`mount.test.ts`, `mount-http.test.ts`, `client-breaker.test.ts`)
  still pass unmodified — confirmed via the full `tests/mcp/` run above.
- Orchestration only triggers for HTTP specs whose `authProvider` exposes
  `waitForRedirect` AND the error is an `UnauthorizedError` — verified by both the
  non-OAuth and already-authorized negative tests.
- Capped at exactly one retry in all paths (success and rethrow) — no loop construct
  exists in `connectMcpClient`, structurally impossible to retry more than once.

**Concerns / follow-ups (none blocking):**
- This is unit-tested against injected fakes, not a live OAuth server round-trip end
  to end through this exact code path (Task 18a's `ab59b35`/`github-mcp.live.test.ts`
  covers a gated live PAT-based remote MCP mount, not the interactive OAuth browser
  flow specifically) — if a live-verify pass against a real OAuth provider is planned
  before Slice 26 lands, this is the seam to point it at.
- `docs/architecture.md` / README / ROADMAP / SDD-ledger prose updates for this fix
  are left to the slice's final docs pass (matches this branch's existing per-task
  commit pattern; no prior task commit in this slice touched `docs/architecture.md`).
