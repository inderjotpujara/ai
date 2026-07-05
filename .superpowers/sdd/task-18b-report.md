### Task 18b (Slice 26): Local mock OAuth 2.1 AS + deterministic end-to-end
test → fix the real "Stored OAuth authorization server metadata is required"
gap the live Linear handshake exposed — Report

**Status:** DONE, GREEN. Red→green ordering verified explicitly (see below).

**The bug, root-caused:** `@ai-sdk/mcp`'s `authInternal` (`node_modules/
@ai-sdk/mcp/dist/index.js`) discovers authorization-server (AS) metadata
(issuer + token_endpoint) on the FIRST `auth()` call — the DCR/redirect one —
and, on the SECOND, code-exchange `auth()` call, requires that same AS
identity back via `getStoredAuthorizationServerInformation(...)` so it can
assert (`assertAuthorizationServerInformationMatches`) the AS hasn't changed
out from under the stored client/tokens. If nothing hands it back, it throws:

> `Stored OAuth authorization server metadata is required when exchanging an
> authorization code`

— exactly the error the live Linear handshake hit.

**Exact SDK contract (read off the installed `.d.ts`/`dist/index.js`, not
assumed):**
```ts
interface OAuthAuthorizationServerInformation {
  authorizationServerUrl: string;
  tokenEndpoint: string;
}
interface OAuthClientProvider {
  ...
  authorizationServerInformation?(): OAuthAuthorizationServerInformation
    | undefined | Promise<OAuthAuthorizationServerInformation | undefined>;
  saveAuthorizationServerInformation?(
    info: OAuthAuthorizationServerInformation,
  ): void | Promise<void>;
  ...
}
```
Both members are exported from the package's public surface (`OAuthAuthorizationServerInformation`
is in the barrel export list at the bottom of `dist/index.d.ts`).

**How the SDK drives it (`authInternal`, `dist/index.js` ~L1147-1325):**
- On the FIRST `auth()` call (no `authorizationCode`), right before
  `redirectToAuthorization`, it calls the module-level helper
  `saveAuthorizationServerInformation({ provider, clientInformation,
  authorizationServerInformation })`, which:
  1. Calls `provider.saveAuthorizationServerInformation(info)` **if the
     provider implements it** (returns `true`), otherwise
  2. Falls back to folding `info` into the `clientInformation` object
     (`addAuthorizationServerInformationToClientInformation`, which sets
     `.authorization_server`/`.token_endpoint` on it) and calling
     `provider.saveClientInformation(...)` with that merged object.
  3. If neither exists, throws `"OAuth authorization server metadata must be
     saveable before starting authorization"`.
- On the SECOND (exchange) `auth()` call, `getStoredAuthorizationServerInformation`
  looks in order: (a) fields embedded on a stored `tokens` object (N/A here —
  no tokens yet), (b) `provider.authorizationServerInformation()` **if
  implemented**, (c) fields embedded on the `clientInformation` object
  returned by `provider.clientInformation()`. If all three come back empty,
  it throws the "Stored OAuth authorization server metadata is required…"
  error.

**Why our provider hit the fallback-drops-the-data case:** `src/mcp/
oauth-provider.ts` already implemented `saveClientInformation`/
`clientInformation`, but only round-tripped `client_id`/`client_secret`
through the token store's `ClientRecord` — so step (2) above silently
persisted a value that the store then truncated back down, and step (c) on
the exchange call read back a `clientInformation` with no
`authorization_server`/`token_endpoint` fields. Reproduced exactly (see
red-run below) before implementing the dedicated members.

**Fix — `src/mcp/oauth-provider.ts` + `src/mcp/token-store.ts`:**
- Added the two optional `OAuthClientProvider` members —
  `authorizationServerInformation()` / `saveAuthorizationServerInformation(info)`
  — backed by a new field on the Task-10 token store record rather than an
  in-memory field on the provider instance. Chose the store over in-memory
  because: (a) Task-18a's orchestration DOES reuse the same provider instance
  across the redirect and exchange `auth()` calls, so in-memory would have
  been sufficient for that one path, but (b) `authInternal`'s
  no-`authorizationCode`/has-`refresh_token` branch calls
  `getStoredAuthorizationServerInformation` again on a *future, possibly
  fresh* provider instance (a new CLI invocation) when refreshing an expired
  access token — an in-memory field would silently regress that path back to
  the same bug the moment persistence mattered. The store is the more robust
  choice for the module's actual lifetime model (a `LiveOAuthClientProvider`
  is constructed fresh per `mountMcpServer` call, not held long-lived).
- `src/mcp/token-store.ts`: added `export type AuthorizationServerInformation
  = { authorizationServerUrl: string; tokenEndpoint: string }` and a new
  **optional** `authorizationServer?: AuthorizationServerInformation` field on
  `ServerAuthRecord`. Backward-compatible: `getServerAuth` already falls back
  to `{}` for a missing key, and old on-disk stores without this field parse
  unchanged (`JSON.parse` + optional field = `undefined`, not an error).
- No `as any` / `@ts-ignore` anywhere in the diff.

**Local mock OAuth 2.1 AS — `tests/mcp/helpers/mock-oauth-as.ts`:**
`Bun.serve`-based, spec-shaped minimum the SDK actually drives:
- `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata:
  `issuer` = the server's own origin (required — mounted at a bare root URL
  with no path so `@ai-sdk/mcp`'s discovery hits exactly this well-known path
  and its `assertMetadataIssuerMatches` passes), `authorization_endpoint`,
  `token_endpoint`, `registration_endpoint`, `response_types_supported:
  ['code']`, `code_challenge_methods_supported: ['S256']`,
  `grant_types_supported: ['authorization_code', 'refresh_token']`.
- `POST /register` (DCR) — echoes the posted `OAuthClientMetadata` back with a
  generated `client_id` (satisfies `OAuthClientInformationFullSchema`).
- `GET /authorize` — immediately `302`s to the caller's `redirect_uri` with
  `?code=...&state=...` appended — **no human step**; stashes
  `{clientId, redirectUri, codeChallenge, state}` keyed by the minted code.
- `POST /token` — validates PKCE S256 (`base64url(sha256(code_verifier)) ===
  stored code_challenge`), single-use codes (deleted after exchange), and
  returns `access_token`/`refresh_token`/`expires_in`; also handles
  `grant_type=refresh_token` for completeness.
- Deliberately does NOT implement `/.well-known/oauth-protected-resource` —
  `discoverOAuthProtectedResourceMetadata`'s call site in `authInternal` is
  wrapped in a bare `try {} catch {}` and falls back to treating the resource
  URL itself as the AS URL, so a plain 404 here is spec-tolerated behavior the
  SDK already handles, not a gap.

**Deterministic test — `tests/mcp/oauth-flow.test.ts`:** drives the REAL
`createOAuthProvider('mock', { storePath, openBrowser })` against the mock AS,
where `openBrowser` is `(url) => { fetch(url).catch(() => {}) }` — a
same-process fetch that follows the mock AS's `302` straight into the
provider's own loopback `Bun.serve` listener, completing capture with zero
human interaction. Flow, mirroring Task-18a's `connectMcpClient` exactly:
1. `auth(provider, { serverUrl: as.url })` → `'REDIRECT'` (DCR happened: `as.registeredClientIds.length === 1`).
2. `await provider.waitForRedirect()` → `{code, state}`.
3. `auth(provider, { serverUrl: as.url, authorizationCode: code, callbackState: state })` → `'AUTHORIZED'`.
4. Asserts: exactly one token grant issued (`as.issuedTokens.length === 1`);
   tokens persisted to the store and match what the mock AS issued; the
   AS-metadata members were exercised — `getServerAuth('mock', storePath)
   .authorizationServer` equals `{authorizationServerUrl: as.url, tokenEndpoint:
   `${as.url}token`}`.
5. A **second**, fresh `createOAuthProvider('mock', { storePath, openBrowser:
   () => { browserOpened = true } })` — `provider2.tokens()` returns the same
   access token with **no** browser open (`browserOpened === false`),
   confirming cross-instance reuse via the store.

**Red → green, verified explicitly:**
- Stashed `src/mcp/oauth-provider.ts` + `src/mcp/token-store.ts` (fix removed,
  test kept) and re-ran `bun test tests/mcp/oauth-flow.test.ts`:
  ```
  MCPClientOAuthError: Stored OAuth authorization server metadata is required
  when exchanging an authorization code
        at authInternal (.../@ai-sdk/mcp/dist/index.mjs:1197:13)
        at async auth (.../@ai-sdk/mcp/dist/index.mjs:1084:18)
        at async <anonymous> (tests/mcp/oauth-flow.test.ts:53:29)
  (fail) ... [14.04ms]
   0 pass / 1 fail
  ```
  This is the exact production error, reproduced fully locally/deterministically.
- Restored the fix (`git stash pop`) and re-ran: `1 pass, 0 fail, 10 expect()
  calls`.

**Verification run inline:**
- `bun test tests/mcp/oauth-flow.test.ts tests/mcp/oauth-provider.test.ts
  tests/mcp/client.test.ts` → 11 pass, 0 fail, 41 expect() calls.
- `bun test tests/mcp/` (full subsystem) → 92 pass, 0 fail, 247 expect() calls.
- `bun run typecheck` → clean.
- `bun run lint:file src/mcp/oauth-provider.ts src/mcp/token-store.ts
  tests/mcp/oauth-flow.test.ts tests/mcp/helpers/mock-oauth-as.ts` → one
  `organizeImports`/format fixup applied via `biome check --write` to the new
  test file (import order + a line-length wrap), then clean; re-ran the full
  inline test set after the auto-fix to confirm no regression.

**Self-review:**
- Existing `oauth-provider.test.ts` (4 tests: token/verifier round-trip,
  client-info round-trip, expires_in conversion, state nonce) and
  `client.test.ts` (6 tests: Task-18a orchestration) pass unmodified.
- Token store schema change is additive/optional (`authorizationServer?:
  AuthorizationServerInformation`) — old stores without the field still parse
  via the existing `?? {}` fallback in `getServerAuth`; no migration needed.
- No secrets logged anywhere in the new code (the mock AS issues clearly-
  fake `mock-access-*`/`mock-refresh-*`/`mock-client-*` tokens/ids, never
  touches the real 0600 token store path, and nothing is written to
  stdout/stderr in the new provider methods or the mock AS).
- `bun run docs:check` still passes (`src/mcp/` subsystem is already
  documented in `docs/architecture.md` §14) — full architecture.md/README/
  ROADMAP prose reconciliation for this fix is left to the slice's final docs
  pass, matching the established per-task pattern on this branch (see
  `task-18a-report.md`; no task commit in `slice-26-altruntime-remote-auth`
  has touched `docs/architecture.md` yet).

**Concerns / follow-ups (none blocking):**
- The mock AS's `/token` refresh-token branch is implemented but not
  exercised by this test (no expiry-then-refresh scenario) — the dedicated
  AS-metadata persistence this task adds is exactly what makes that future
  refresh flow work on a fresh provider instance too, per the design
  rationale above, but a dedicated refresh-flow test is left as a natural
  follow-on if Slice 26 wants that specific path live-verified as well.
- This closes the gap Task 18a's live-verify run against Linear surfaced;
  worth a follow-up live re-run against `MCP_OAUTH_LIVE=1 bun test
  tests/integration/linear-oauth.live.test.ts` before the slice lands, to
  confirm the fix also resolves the original real-world failure end-to-end
  (this task's scope was the deterministic local repro + fix; the live
  gated test file already exists and is unmodified).
