# Task 11 Report: Browser loopback OAuth callback server (Slice 26)

*(Note: this path previously held a stale Slice-21 report for a differently-numbered
Task 11 — "Migrate verified-build withWallClock + runtime probe literals." Overwritten
here per the file-reuse convention that report itself documented.)*

**Status:** DONE.

## Files changed

- `src/mcp/loopback.ts` (new) — `awaitOAuthRedirect(buildAuthUrl, expectedState, deps)`
  and `loopbackRedirectUri(port)`.
- `tests/mcp/loopback.test.ts` (new) — two tests (success path + state-mismatch path).

## Signature (per the brief's NOTE, not the top-level Interfaces block)

```ts
export function loopbackRedirectUri(port: number): string; // http://127.0.0.1:<port>/callback

export function awaitOAuthRedirect(
  buildAuthUrl: (redirectUri: string) => string,
  expectedState: string,
  deps?: { openBrowser?: (url: string) => void; timeoutMs?: number },
): Promise<{ code: string; state: string; redirectUri: string }>;
```

The brief's top "Interfaces" block showed `awaitOAuthRedirect(authUrl, expectedState, deps)`,
but its NOTE (and this task's dispatch instructions) explicitly call for the
`buildAuthUrl(redirectUri)` callback signature so the redirect_uri (with the real
ephemeral port) can be embedded in the authorization URL before it's opened. Implemented
that signature; the `port` field was dropped from `LoopbackDeps` (not needed — Bun.serve
binds `port: 0` and reports the actual bound port back via `server.port`).

## Behavior implemented

- Binds `127.0.0.1:0` via `Bun.serve` (ephemeral port).
- Computes `redirectUri = http://127.0.0.1:<server.port>/callback`, calls
  `buildAuthUrl(redirectUri)`, then `deps.openBrowser(authUrl)` — default `openBrowser`
  is `Bun.spawn(['open', url])` (darwin `open`).
- `GET /callback?code&state`: `state !== expectedState` → responds 400 and rejects
  `Error('state mismatch')`; otherwise responds 200 "You may close this window" and
  resolves `{code, state, redirectUri}`.
- Whole wait is guarded by `withWallClock(deps.timeoutMs ?? 180000, ...)` from
  `src/reliability/timeout.ts`.
- Server is stopped on every exit path via `.finally(() => server?.stop())` chained onto
  the `withWallClock` promise — the promise-based equivalent of the requested try/finally
  (resolve, reject-on-mismatch, and timeout-reject all funnel through it).
  Used the **graceful** `stop()` (not `stop(true)`) deliberately: an initial `stop(true)`
  attempt force-closed the in-flight `/callback` response socket before it flushed,
  producing an `ECONNRESET` on the test's `fetch()` caller — graceful stop lets the
  response finish sending, then stops accepting new connections.
- No secrets logged anywhere in the module.

## Tests (`bun test tests/mcp/loopback.test.ts` — 2 pass)

1. `captures code+state from the callback` — injected `openBrowser` decodes the
   `redirect_uri` query param out of the built authUrl and `fetch`s it with
   `code=CODE123&state=xyz`; asserts the resolved `{code, state, redirectUri}` (also
   asserts `redirectUri` matches `http://127.0.0.1:<port>/callback`).
2. `rejects on state mismatch and stops the server` — injected `openBrowser` fetches the
   callback with a wrong `state`; asserts the promise rejects with `'state mismatch'`.

TDD: wrote the test first, confirmed it failed (`Cannot find module '../../src/mcp/loopback.ts'`),
then implemented and both tests (plus the state-mismatch test added per the workflow
contract) passed.

## Verification run

- `bun test tests/mcp/loopback.test.ts` → 2 pass, 0 fail.
- `bun run typecheck` → clean (one fixup needed: `server.port` types as `number | undefined`
  in Bun's typings even after binding a TCP port; guarded with an explicit
  `if (server.port === undefined) reject(...)` branch rather than a non-null assertion or
  `?? 0` fallback, so a genuinely-unbound server surfaces as a real rejection instead of a
  silently wrong `redirectUri`).
- `bun run lint:file src/mcp/loopback.ts tests/mcp/loopback.test.ts` → clean (biome
  auto-fixed formatting; manually removed two `noNonNullAssertion` warnings from the test
  file by extracting a small `redirectUriFrom(authUrl)` helper that throws instead of `!`).

## Self-review

- Confirmed the server-stop-on-every-exit-path guarantee: success (resolve), state
  mismatch (reject), and timeout (withWallClock's race rejects) all pass through the same
  `.finally(() => server?.stop())` — no path leaves the listener bound. Verified this
  concretely by observing the ECONNRESET regression when first using `stop(true)` and
  fixing it with graceful `stop()`.
- No secrets (code, state, or anything else) are logged.

## Commit

`5d85cb6` — "feat(mcp): browser loopback OAuth redirect capture" — staged only
`src/mcp/loopback.ts` and `tests/mcp/loopback.test.ts` by explicit path (confirmed via
`git status --short` before commit); other working-tree edits from sibling task agents
sharing this working tree were left untouched.

**Concerns:** none blocking. Minor: `LoopbackDeps` dropped the brief's optional `port`
field since the caller-driven `buildAuthUrl(redirectUri)` signature makes a caller-supplied
port unnecessary (the real bound port is always used). Task 12 (OAuth provider) should call
`awaitOAuthRedirect` with its own `buildAuthUrl` closure that embeds PKCE/state params
alongside the redirect_uri.

## Fix: Important reviewer finding — missing-code resolved instead of rejected

**Finding:** the `/callback` handler resolved with `code: ''` when the `code` query param
was missing but `state` matched (`src/mcp/loopback.ts:64,70` in the reviewed diff). This
would let an empty authorization code flow into Task 12's token exchange instead of failing
fast at the loopback boundary.

**Change:** added a missing-`code` guard in `src/mcp/loopback.ts`, placed immediately after
the existing state-mismatch check (so state is still validated first): if `code === ''`,
reject `new Error('missing code')` and respond 400 — mirroring the state-mismatch branch's
shape exactly. Updated the function's doc comment to mention the new rejection case. The
reject still propagates through the same `.finally(() => server?.stop())` on the outer
`withWallClock` promise, so the server is stopped on this path too (confirmed by the new
test passing without hanging/leaking a listener).

Added `rejects on missing code and stops the server` to `tests/mcp/loopback.test.ts`,
mirroring the state-mismatch test's structure: injected `openBrowser` fetches the callback
URL with `state=expected-state` and no `code` param at all, asserts the promise rejects with
`'missing code'`.

### Verification run

```
$ bun test tests/mcp/loopback.test.ts
bun test v1.3.11 (af24e281)

 3 pass
 0 fail
 5 expect() calls
Ran 3 tests across 1 file. [15.00ms]

$ bun run typecheck
$ tsc --noEmit
(clean, no output)

$ bun run lint:file src/mcp/loopback.ts tests/mcp/loopback.test.ts
$ biome check src/mcp/loopback.ts tests/mcp/loopback.test.ts
Checked 2 files in 3ms. No fixes applied.
```

### Commit

`19889f1` — "fix(mcp): reject loopback callback on missing authorization code" — staged
only `src/mcp/loopback.ts` and `tests/mcp/loopback.test.ts`.

**Concerns:** none blocking. The guard only fires when `code` is absent or explicitly empty
(`''`); it does not attempt to validate the code's shape/format, which is out of scope for
the loopback layer and correctly left to Task 12's token exchange / the authorization
server.
