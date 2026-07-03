# Task 23 report: MCP OAuth (`authProvider`) for remote servers

## What shipped

Wired an OAuth auth mode alongside the existing static-key mode for remote
(Streamable HTTP) MCP servers, contract-tested with a mocked provider. No new
dependencies; degrade-never-crash throughout.

### `src/mcp/types.ts`
- New string enum `McpAuthKind { Static = 'static', OAuth = 'oauth' }`.
- `httpAuthSchema = z.object({ kind: z.literal(McpAuthKind.OAuth) })`, added as
  an optional `auth` field on `httpEntrySchema`.
- `HttpServerEntry` gained `auth?: { kind: McpAuthKind.OAuth }`. Absent = the
  existing static-header behavior, byte-for-byte unchanged.

### `src/mcp/config.ts`
- `toEntry()` now passes `auth: data.auth` through onto the parsed
  `HttpServerEntry` (one-line addition; no other logic touched).

### `src/mcp/client.ts`
- Read the **installed** `@ai-sdk/mcp@1.0.56` types directly
  (`node_modules/@ai-sdk/mcp/dist/index.d.ts`) rather than guessing the API.
  Confirmed the SDK's `MCPTransportConfig` (the object form accepted by
  `createMCPClient({ transport })`) has a real, first-class
  `authProvider?: OAuthClientProvider` field — this is **not** a
  closest-available-substitute; the SDK supports OAuth natively.
- `McpHttpSpec` gained `authProvider?: OAuthClientProvider` (type imported
  from `@ai-sdk/mcp`).
- Extracted `buildHttpTransportConfig(spec: McpHttpSpec)` — a pure function
  that builds `{ type: 'http', url, headers, authProvider }`. `mountMcpServer`
  now calls it instead of inlining the object literal. This split exists
  specifically so the OAuth wiring is unit-testable without a network
  round-trip or mocking the `@ai-sdk/mcp` module.

### `src/mcp/mount.ts`
- `MountAllDeps` gained `authProviders?: Record<string, OAuthClientProvider>`
  — a name-keyed map of live provider instances, supplied by the caller.
  **Never sourced from JSON config**: an `OAuthClientProvider` is a stateful
  runtime object (methods like `tokens()`, `saveTokens()`,
  `redirectToAuthorization()`), not data, so it can't live in `mcp.json`.
  This mirrors the existing `deps.mount` / `deps.consent` DI pattern already
  used for testability.
- New `resolveAuthProvider(entry, authProviders, warn)`: for an HTTP entry
  with `auth.kind === McpAuthKind.OAuth`, looks up `authProviders[entry.name]`.
  Found → returned as-is. Missing → **warns** (`"...declares OAuth but no
  authProvider is registered — live OAuth is deferred; mounting without
  auth"`) and returns `undefined` — the entry still mounts (using whatever
  static `headers` it has, i.e. none by default), it just isn't authenticated.
  Never throws.
- `toSpec()` takes the resolved `authProvider` as a second argument and
  includes it in the `McpMountSpec` for HTTP entries.
- The mount loop in `mountAll()` calls `resolveAuthProvider` then
  `toSpec(entry, authProvider)` before invoking `mount(...)`.

## What's contract-tested vs. deferred-live

**Contract-tested (mocked, no network):**
1. `tests/mcp/client.test.ts` (new) — `buildHttpTransportConfig`:
   - An OAuth spec's `authProvider` reaches the transport config unchanged,
     and the mock's `tokens()` resolves to the fixed mocked token.
   - A static-key spec is unchanged: `headers` reach the transport config,
     `authProvider` is `undefined`.
   - Exports `mockOAuthProvider(token)`: a minimal, fully-typed
     `OAuthClientProvider` stub (structurally complete — `tokens`,
     `saveTokens`, `redirectToAuthorization`, `saveCodeVerifier`,
     `codeVerifier`, `redirectUrl`, `clientMetadata`, `clientInformation`) so
     the type is exercised honestly, not cast through `as any`.
2. `tests/mcp/mount-all.test.ts` (extended) — three new cases against the real
   `mountAll()` with an injected `mount` spy:
   - An HTTP entry declaring `auth: { kind: McpAuthKind.OAuth }` with a
     registered `deps.authProviders['name']` → the spec handed to `mount()`
     carries that exact provider, and its mocked `tokens()` resolves as
     expected.
   - The same entry with **no** registered provider → mounts successfully
     (`reg.mounted` includes it) with `authProvider` undefined, and a warning
     naming the entry + "deferred" is emitted — degrade, not crash.
   - A plain static-key HTTP entry (no `auth` field) → `headers` reach the
     mount spec unchanged, `authProvider` stays `undefined` — proves the
     existing path is byte-for-byte unaffected.
   - RED confirmed first: temporarily stashed the implementation
     (`src/mcp/{client,mount,types,config}.ts`) and re-ran both test files —
     both failed with `SyntaxError: Export named 'buildHttpTransportConfig'
     not found`. Un-stashed, re-ran → all green.

**Deferred (explicitly out of scope, per task brief):**
- **Live OAuth token exchange / browser redirect flow.** The SDK's
  `OAuthClientProvider` interface requires a full implementation
  (`redirectToAuthorization`, PKCE `codeVerifier`/`saveCodeVerifier`,
  persisted `clientInformation`, etc.) plus a real OAuth-capable remote MCP
  server to authorize against — neither exists in this repo/environment.
  `resolveAuthProvider`'s job is the plumbing seam (accept + pass through a
  provider); constructing a *real* provider (token persistence, refresh,
  the actual `auth()` handshake exported by `@ai-sdk/mcp`) is a follow-on.
- **GitHub remote-HTTP live-verify** (pack's `github` entry, static PAT via
  `GITHUB_PAT`) stays deferred — no `GITHUB_PAT` set in this environment.
  Unrelated to this task's OAuth wiring (GitHub's entry still uses the
  static-header path, unchanged), noted here per the task brief's instruction
  to log both deferrals together.

## Verify (inline, focused — no full suite run per instructions)

- `bun run typecheck` → **0 errors**.
- `bun run lint:file -- src/mcp/client.ts src/mcp/config.ts src/mcp/mount.ts src/mcp/types.ts tests/mcp/client.test.ts tests/mcp/mount-all.test.ts`
  → clean (one `--write` pass needed for import-order/formatting on
  `mount.ts` and `client.test.ts`, no logic change).
- `bun run test:file -- "tests/mcp/client.test.ts" "tests/mcp/mount-all.test.ts" "tests/mcp/config.test.ts" "tests/mcp/mount-http.test.ts" "tests/mcp/pack.test.ts" "tests/mcp/consent.test.ts"`
  → **49 pass / 0 fail / 119 expect() calls** across 6 files. RED-first
  verified for the two new/changed test files as described above.
- Full `bun test` suite intentionally **not** run (per instructions — the
  controller runs it after commit).

## Files touched

- `src/mcp/types.ts` — `McpAuthKind` enum, `httpAuthSchema`, `HttpServerEntry.auth`.
- `src/mcp/config.ts` — pass `auth` through in `toEntry()`.
- `src/mcp/client.ts` — `McpHttpSpec.authProvider`, `buildHttpTransportConfig()`.
- `src/mcp/mount.ts` — `MountAllDeps.authProviders`, `resolveAuthProvider()`, `toSpec()` threading.
- `tests/mcp/client.test.ts` (new) — pure transport-config contract tests + `mockOAuthProvider` helper.
- `tests/mcp/mount-all.test.ts` — 3 new cases (OAuth-with-provider, OAuth-without-provider degrade, static-path-unchanged).

## Docs

Architecture.md / README / ROADMAP not touched by this task — this is one of
several WS5 tasks landing on `slice-18-debt-wrapup-mlx`; the slice-level doc
pass (all four living surfaces + SDD ledger) is assumed to happen once per
slice, not per task, consistent with prior slices' ledger pattern (e.g. S17
Task 8 was a dedicated docs-only task). Flagging this explicitly so the
docs-pass task doesn't miss it: architecture.md §14 ("MCP mount registry &
starter pack") should get a short OAuth-authProvider paragraph, and the
existing "No OAuth" line in §18 (agent-builder safety model) should be
checked for continued accuracy (the agent-builder itself still never emits an
`auth` field — this task only added the primitive, not a suggester change).
