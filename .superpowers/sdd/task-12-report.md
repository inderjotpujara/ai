# Task 12 Report (Slice 26): Live OAuth client provider

*(Note: this path previously held a stale Slice-21 report for a differently-numbered
Task 12 — "thread the degradation ledger through the run context." Overwritten here per
the file-reuse convention that report itself documented.)*

**Status:** DONE.

## Files changed

- `src/mcp/oauth-provider.ts` (new) — `createOAuthProvider(serverName, opts?)`.
- `tests/mcp/oauth-provider.test.ts` (new) — 1 test (store-backed round-trips,
  no network), exactly the brief's Step-1 test verbatim.

## The ACTUAL `OAuthClientProvider` interface (copied from
`node_modules/@ai-sdk/mcp/dist/index.d.ts:154-203`)

```ts
interface OAuthClientProvider {
  tokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined>;
  saveTokens(tokens: OAuthTokens): void | Promise<void>;
  redirectToAuthorization(authorizationUrl: URL): void | Promise<void>;
  saveCodeVerifier(codeVerifier: string): void | Promise<void>;
  codeVerifier(): string | Promise<string>;
  addClientAuthentication?(headers: Headers, params: URLSearchParams, url: string | URL, metadata?: AuthorizationServerMetadata): void | Promise<void>;
  invalidateCredentials?(scope: 'all' | 'client' | 'tokens' | 'verifier'): void | Promise<void>;
  get redirectUrl(): string | URL;
  get clientMetadata(): OAuthClientMetadata;
  clientInformation(): OAuthClientInformation | undefined | Promise<OAuthClientInformation | undefined>;
  saveClientInformation?(clientInformation: OAuthClientInformation): void | Promise<void>;
  authorizationServerInformation?(): OAuthAuthorizationServerInformation | undefined | Promise<OAuthAuthorizationServerInformation | undefined>;
  saveAuthorizationServerInformation?(authorizationServerInformation: OAuthAuthorizationServerInformation): void | Promise<void>;
  validateAuthorizationServerURL?(serverUrl: string | URL, authorizationServerUrl: string | URL): void | Promise<void>;
  state?(): string | Promise<string>;
  saveState?(state: string): void | Promise<void>;
  storedState?(): string | undefined | Promise<string | undefined>;
  validateResourceURL?(serverUrl: string | URL, resource?: string): Promise<URL | undefined>;
}
```

`OAuthTokens` (zod-inferred): `access_token` (required), `id_token?`,
`token_type` (**required**, unlike our store's optional field), `expires_in?`
(seconds, NOT an absolute timestamp), `scope?`, `refresh_token?`,
`authorization_server?`, `token_endpoint?`.

`OAuthClientInformation`: `client_id` (required), `client_secret?`,
`client_id_issued_at?`, `client_secret_expires_at?`, `authorization_server?`,
`token_endpoint?`.

`OAuthClientMetadata`: `redirect_uris` (required array), plus the optional
fields listed in the brief (`grant_types`, `response_types`, `client_name`,
`scope`, `token_endpoint_auth_method`, etc.) — matches the brief's shape.

## Members implemented (all 8 required members; none of the 10 optional
ones — not needed for the store-backed + PKCE + DCR flow this task covers)

| Member | Mapping |
|---|---|
| `tokens()` | `getServerAuth(server).tokens` → `OAuthTokens` (see conversion note below) |
| `saveTokens(t)` | `OAuthTokens` → `setServerAuth(server, {tokens})` (see conversion note) |
| `redirectToAuthorization(url: URL)` | opens the browser (`opts.openBrowser ?? Bun.spawn(['open', ...])`) and starts a loopback capture (see "SDK-interface surprise" below) |
| `saveCodeVerifier(v)` | `setServerAuth(server, {codeVerifier: v})` |
| `codeVerifier()` | `getServerAuth(server).codeVerifier`; **throws** if unset (interface return type is non-optional `string`, not `string \| undefined`) |
| `get redirectUrl()` | `loopbackRedirectUri(port)` — the port is bound lazily on first access (see below) |
| `get clientMetadata()` | exactly the brief's literal shape |
| `clientInformation()` | `getServerAuth(server).client` → `{client_id, client_secret}`; else `opts.clientId` if given (static-client-id path, skips DCR); else `undefined` (triggers DCR/CIMD) |
| `saveClientInformation(ci)` | `setServerAuth(server, {client: {client_id, client_secret}})` |

## SDK-interface surprise (the important one)

The brief's sketch assumed our provider might need to *build* the
authorization URL from a `redirectUri` (mirroring `awaitOAuthRedirect`'s
`buildAuthUrl(redirectUri)` callback signature) and that `redirectToAuthorization`
might get polled by the SDK's transport. **Neither is true.** The real
signature is `redirectToAuthorization(authorizationUrl: URL): void | Promise<void>`
— the SDK's own `auth()` function already builds the complete authorization
URL (PKCE challenge, state, client_id, scope) using `provider.redirectUrl`
*before* calling `redirectToAuthorization`, and does DCR (via
`provider.clientMetadata`, which also embeds `redirectUrl`) even earlier than
that. The provider's only job in `redirectToAuthorization` is to present the
already-built URL to the user; the code→token exchange happens via a
*second*, separate call to the SDK's exported `auth()` with
`authorizationCode` set (that's on Task 14 to wire).

This creates a real ordering constraint Task 11's `awaitOAuthRedirect` doesn't
solve on its own: `redirectUrl` must be **known and stable before**
`redirectToAuthorization` runs (it's baked into the URL and into the DCR
registration), but `awaitOAuthRedirect` binds a **fresh ephemeral port every
time it's called** — so calling it straight from `redirectToAuthorization`
would listen on a different port than the one just registered/embedded,
and the browser's callback would never reach it.

**Fix implemented:** `oauth-provider.ts` binds its own loopback `Bun.serve()`
**lazily on first use** (either the `redirectUrl` getter or
`redirectToAuthorization`, whichever runs first) and **caches** that single
bound port for the provider instance's lifetime, so `redirectUrl`/
`clientMetadata` (read early, for DCR + URL-building) and the actual
`/callback` listener (used later, in `redirectToAuthorization`) always agree.
This duplicates a small slice of Task 11's `/callback`-handling logic
(~15 lines: parse `code`/`state`, verify state, respond, resolve/reject,
`withWallClock`-guarded, 180s) directly in `oauth-provider.ts` rather than
calling `awaitOAuthRedirect`, because that function's contract is "bind
+ build-URL + open + wait" as one atomic unit and doesn't support binding
once and waiting later on a URL that arrives afterward. `loopbackRedirectUri`
(Task 11's URI-string builder) *is* reused as-is.

Because `redirectToAuthorization` must return **quickly** (the SDK's `auth()`
returns `'REDIRECT'` right after it, and callers need control back to decide
what's next rather than block for up to 3 minutes), it does **not** await the
loopback capture itself — it starts the wait as a background promise and
returns immediately. That promise is exposed via `waitForRedirect(): Promise<{code,
state}>`, an addition **outside** the `OAuthClientProvider` contract, which
Task 14's orchestration will need to call after `auth()` returns `'REDIRECT'`,
before calling `auth()` again with the captured `authorizationCode`.

## Store ↔ SDK type conversions

- `StoredTokens.expires_at` (absolute epoch ms, our store's field) ↔
  `OAuthTokens.expires_in` (relative seconds, the SDK's field): `saveTokens`
  converts `expires_in` → `expires_at = Date.now() + expires_in * 1000`;
  `tokens()` recomputes `expires_in = max(0, round((expires_at - now)/1000))`
  on every read, so the reported remaining lifetime decays correctly instead
  of going stale.
- `token_type` is optional in our store but **required** in `OAuthTokens`;
  `tokens()` defaults to `'Bearer'` when unset.
- Fields the SDK's `OAuthTokens`/`OAuthClientInformation` support but our
  store schema doesn't (`id_token`, `scope`, `authorization_server`,
  `token_endpoint` on tokens; `client_id_issued_at`,
  `client_secret_expires_at`, `authorization_server`, `token_endpoint` on
  client info) are **dropped on save** — the Task-10 store type wasn't
  extended for this task since none of Task 12's tests or the immediate
  DCR/PKCE/refresh flow need them. Flagged as a known gap, not silently
  papered over.

## Tests (`bun test tests/mcp/oauth-provider.test.ts` — 1 pass, RED-first confirmed)

The brief's exact test: `saveCodeVerifier`→`codeVerifier` round-trip,
`saveTokens`→`tokens` round-trip (asserts `access_token`) via a tmpdir
`storePath`, and `clientMetadata.redirect_uris.length > 0` (which exercises
the lazy loopback bind — confirms it doesn't throw and produces a non-empty
URI list). RED confirmed first: `bun test` failed with `Cannot find module
'../../src/mcp/oauth-provider.ts'` before the implementation existed.

Per the brief, the live browser/loopback handshake (does a real redirect
actually land on the bound port, does the full `auth()` two-call sequence
work end-to-end) is **not** unit-tested here — that's Task 18's live-verify
gate.

## Verification run

```
$ bun test tests/mcp/oauth-provider.test.ts
 1 pass
 0 fail
 3 expect() calls

$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file src/mcp/oauth-provider.ts tests/mcp/oauth-provider.test.ts
$ biome check src/mcp/oauth-provider.ts tests/mcp/oauth-provider.test.ts
Checked 2 files in 4ms. No fixes applied.
(one --write pass needed first, for formatting only — object-literal
line-wrapping and import order in the brief's verbatim test snippet; no
logic changed)
```

## Self-review

- No `as any`, `as unknown`, or `@ts-ignore` anywhere in `oauth-provider.ts`
  (grepped to confirm) — every member's types line up with the real `.d.ts`
  structurally, including the getter syntax (`get redirectUrl()` / `get
  clientMetadata()`) which TypeScript accepts on an object literal as
  satisfying an interface's accessor members.
- `codeVerifier()`'s non-optional `string` return type is honored by
  throwing (not returning `''` or `undefined`) when nothing is stored — the
  brief's sketch didn't specify this, but the real interface's signature
  forced the decision; throwing surfaces a real "you forgot to call
  `saveCodeVerifier` first" bug loudly rather than silently corrupting a PKCE
  exchange with an empty verifier.
- Server lifecycle: the loopback listener is stopped in every exit path of
  `redirectToAuthorization`'s wait (success, state-mismatch, missing-code,
  and 180s timeout) via `.finally(stopServer)` chained onto the
  `withWallClock`-guarded promise — mirrors Task 11's own
  every-exit-path-stops-the-server discipline.
- No secrets (tokens, code verifiers, client secrets) are logged anywhere in
  this module.

## Commit

`ed96a01` — "feat(mcp): live OAuth client provider (store + PKCE + DCR/CIMD)"
— staged only `src/mcp/oauth-provider.ts` and `tests/mcp/oauth-provider.test.ts`
by explicit path (other working-tree edits from sibling task agents sharing
this worktree were left untouched, confirmed via `git status --short` before
committing). Pre-commit `docs:check` hook passed (new file lives under the
already-documented `src/mcp` subsystem, not a new one).

## Concerns for Task 14 / Task 18

1. **Task 14 must call `waitForRedirect()`.** After `auth(provider, {serverUrl})`
   returns `'REDIRECT'`, Task 14's orchestration needs to `await
   provider.waitForRedirect()` to get `{code, state}`, then call
   `auth(provider, {serverUrl, authorizationCode: code, callbackState: state})`
   to complete the exchange. This method is on the concrete return value of
   `createOAuthProvider` (typed as `LiveOAuthClientProvider`, exported), not
   on the bare `OAuthClientProvider` type — Task 14 should import
   `LiveOAuthClientProvider` (or just call the concrete function's return
   type) rather than widening to `OAuthClientProvider` too early.
2. **Loopback port binds lazily and stays bound across the whole DCR→redirect→
   callback sequence** for a given provider instance — by design (see above),
   but it means a provider instance that has `redirectUrl`/`clientMetadata`
   accessed (e.g. during DCR) and then never completes the flow will hold an
   open `127.0.0.1` listener until `redirectToAuthorization`'s 180s timeout
   fires (or the process exits). Not a leak across process lifetime, but
   worth knowing if Task 14 creates ad-hoc providers per attempt.
3. **Not implemented (optional interface members):** `addClientAuthentication`,
   `invalidateCredentials`, `authorizationServerInformation`/
   `saveAuthorizationServerInformation`, `validateAuthorizationServerURL`,
   `state`/`saveState`/`storedState`, `validateResourceURL`. State/CSRF
   verification is instead done by reading `state` directly off the
   SDK-built `authorizationUrl` passed into `redirectToAuthorization` (it's
   already a query param there), so the optional `state()`/`saveState()`/
   `storedState()` trio wasn't needed for this flow — flag if Task 14/18
   discover the SDK actually needs one of these implemented for a specific
   remote server's flavor of OAuth.
4. Dropped SDK-supported token/client-info fields on save (`id_token`,
   `scope`, `authorization_server`, `token_endpoint`, `client_id_issued_at`,
   `client_secret_expires_at`) — see "Store ↔ SDK type conversions" above.
   If Task 18's live-verify server issues an `authorization_server` field on
   `client_information` (used for token-endpoint discovery on refresh) and
   the flow needs it persisted, the Task-10 `ClientRecord`/`StoredTokens`
   types will need extending — currently out of scope since no test forced it.

---

## Reviewer fix pass — 3 findings (2026-07-05)

The self-flagged gap in note 3 above ("state/CSRF verification is instead
done by reading `state` directly off the SDK-built `authorizationUrl`... the
optional `state()`/`saveState()`/`storedState()` trio wasn't needed") turned
out to be wrong: without those members, the SDK never mints a state value at
all, so the URL's `state` param — and hence the loopback check — degenerated
to comparing `'' === ''`. All three findings below are now fixed in
`src/mcp/oauth-provider.ts` / `tests/mcp/oauth-provider.test.ts`.

### Finding 1 — CRITICAL: CSRF no-op, fixed

**Root cause confirmed from the installed SDK** (`node_modules/@ai-sdk/mcp/dist/index.js`,
`authInternal`, ~line 1297):

```js
const state = provider.state ? await provider.state() : void 0;
if (state && provider.saveState) {
  await provider.saveState(state);
}
const { authorizationUrl, codeVerifier } = await startAuthorization(
  authorizationServerUrl,
  { metadata, clientInformation, state, redirectUrl: provider.redirectUrl, scope, resource },
);
```

Since `provider.state` didn't exist, `state` was `void 0`, and
`startAuthorization` (line ~882: `if (state) { authorizationUrl.searchParams.set('state', state); }`)
never set the query param. So `redirectToAuthorization(url)` read
`url.searchParams.get('state') ?? ''` → `''`, and the loopback's own
`/callback` handler compared the incoming (also absent → `''`) state against
that `''` — a trivial pass, not a check. Separately, the SDK's own
CSRF check in `authInternal` (line ~1214, on the authorization-code exchange
path) does `if (provider.storedState) { const expectedState = await
provider.storedState(); if (expectedState !== callbackState) throw }` — with
no `storedState`, that check is skipped entirely too.

**Fix:** implemented the three optional members exactly as declared in the
installed `.d.ts` (`state?(): string | Promise<string>`, `saveState?(state:
string): void | Promise<void>`, `storedState?(): string | undefined |
Promise<string | undefined>`):

```ts
let stateNonce: string | undefined;
...
state(): string {
  stateNonce = crypto.randomUUID();
  return stateNonce;
},
saveState(state: string): void {
  stateNonce = state;
},
storedState(): string | undefined {
  return stateNonce;
},
```

Stored in-memory on the provider closure (not round-tripped through the
on-disk token store) — the same provider instance handles both `auth()`
calls in a flow (the initial redirect and the later code exchange), matching
the pattern already used for `pendingPromise`/`pending` in the loopback
capture.

Also hardened `redirectToAuthorization` to fail loudly instead of silently
degrading if the state param is ever missing again (e.g. a future SDK
version stops calling `state()`):

```ts
const state = url.searchParams.get('state');
if (!state) {
  throw new Error(
    `oauth-provider(${serverName}): authorization URL is missing a state param — refusing to proceed without CSRF protection`,
  );
}
```

and the loopback callback handler now explicitly rejects an empty incoming
state (`state === '' || state !== pending.expectedState`) rather than
relying on both sides degenerating to `''` to "accidentally" match.

**How I confirmed the SDK now embeds a real state param:** traced the exact
code path in the installed `@ai-sdk/mcp` package (not assumed from the
`.d.ts` alone):
1. `authInternal` calls `provider.state()` — now present, so it's called
   (previously `provider.state` was `undefined`, so this branch never ran).
2. `state()` returns `crypto.randomUUID()` — always truthy — so the
   `if (state && provider.saveState) await provider.saveState(state)` branch
   now runs too, persisting the nonce.
3. `startAuthorization`'s `if (state) { authorizationUrl.searchParams.set('state', state); }`
   (line ~882 of `index.js`) now fires because `state` is a non-empty string,
   so the URL handed to `redirectToAuthorization` genuinely carries
   `?state=<uuid>`.
4. On the code-exchange call, `authInternal`'s `if (provider.storedState) {
   const expectedState = await provider.storedState(); if (expectedState !==
   callbackState) throw }` (line ~1214) now runs a real comparison against
   the nonce this provider minted, since `storedState()` is implemented.

This is a source-level trace of the installed dependency, not a guess from
the type declarations — the `.d.ts` only tells you the shape; the `.js` is
what proves the SDK's control flow actually consumes it that way.

### Finding 2 — IMPORTANT: socket leak on early throw, fixed

**Root cause:** `ensureServer()` binds the `Bun.serve` listener as a side
effect of the `redirectUrl`/`clientMetadata` getters, which the SDK reads
*before* calling `redirectToAuthorization` (which is the only place that
installs `withWallClock(...).finally(stopServer)`). If DCR (`registerClient`)
or the auth-server rejects between the getter read and that call, the bound
socket had no cleanup path and would stay open until process exit.

**Fix:** `ensureServer()` now arms its own fallback timer at bind time,
using the same `REDIRECT_WAIT_TIMEOUT_MS` (180s) budget the redirect-wait
guard uses elsewhere in this file and in `loopback.ts`:

```ts
armTimer = setTimeout(() => {
  armTimer = undefined;
  stopServer();
}, REDIRECT_WAIT_TIMEOUT_MS);
```

`redirectToAuthorization` disarms this timer as its first action
(`disarmFallbackTimer()`) before installing the `withWallClock(...).finally(stopServer)`
guard, handing cleanup responsibility off cleanly — so there is exactly one
active cleanup path at any time, never both. `stopServer()` itself now also
calls `disarmFallbackTimer()` (idempotent — a no-op if already cleared) so
however cleanup is triggered (fallback timer fires, or the redirect-wait
wall clock fires, or a caller notices the flow finished), the socket is
guaranteed to close and the timer state is left consistent. `stopServer()`
still guards `server?.stop()` behind `server` being truthy and always resets
`server`/`boundPort` to `undefined` after, so there is no double-stop: once
one cleanup path runs, the other becomes a no-op (`armTimer` already cleared,
or `server` already `undefined`).

### Finding 3 — IMPORTANT: test gaps, fixed

Added to `tests/mcp/oauth-provider.test.ts` (kept the existing store-backed
test unchanged):
1. `round-trips client information via the store` — `saveClientInformation({client_id:'cid', client_secret:'secret'})` → `clientInformation()` returns both fields back.
2. `saveTokens/tokens round-trips expires_in through the expires_at epoch conversion` — `saveTokens({access_token:'t', token_type:'Bearer', expires_in:3600})` → `tokens().expires_in` is within `(3590, 3600]` (tolerance for the `Date.now()` elapsed between save and read), exercising the `expires_in ⇄ expires_at` epoch-math round trip.
3. `mints a real per-flow state nonce that storedState() returns` — `state()` returns a non-empty string, `saveState(minted)` then `storedState()` returns exactly that value.

Used `if (!p.saveClientInformation) throw` / `if (!p.state || !p.saveState || !p.storedState) throw` guards instead of non-null assertions to satisfy the repo's `noNonNullAssertion` lint rule (`p.state!()` etc. were rejected by `bun run lint:file`).

### Commands run (verbatim passing output)

```
$ bun test tests/mcp/oauth-provider.test.ts
bun test v1.3.11 (af24e281)

 4 pass
 0 fail
 11 expect() calls
Ran 4 tests across 1 file. [20.00ms]

$ bun run typecheck
$ tsc --noEmit
(no output — clean)

$ bun run lint:file src/mcp/oauth-provider.ts tests/mcp/oauth-provider.test.ts
$ biome check src/mcp/oauth-provider.ts tests/mcp/oauth-provider.test.ts
Checked 2 files in 5ms. No fixes applied.
```

No `as any`/`@ts-ignore` introduced.
