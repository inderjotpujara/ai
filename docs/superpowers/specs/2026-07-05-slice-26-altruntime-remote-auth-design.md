# Slice 26 — Alternate-runtime + remote-auth completion (design)

**Date:** 2026-07-05
**Branch:** `slice-26-altruntime-remote-auth`
**Status:** design approved, spec under review
**Phase:** debt burn-down (logged through Slices 14–18) — the last runtime/auth completion before the held v7 slices (23/24/25).

## 1. Why this slice

Two clusters of deliberately-deferred debt, completed together:

- **Alternate runtimes.** LM Studio and llama.cpp today have **download adapters only**
  (contract-tested, live-verify deferred). Neither is a real **inference** runtime. MLX *is*
  a runtime (Slice 18) but a **no-op thin adapter** — it assumes the user launched
  `mlx_lm.server`, its `warm`/`unload` do nothing, and dynamic context is dropped.
- **Remote MCP auth.** The OAuth `authProvider` seam is contract-tested only: **no live
  handshake, no token store, and no production caller populates `deps.authProviders`**. The
  GitHub-PAT remote-HTTP path is code-complete but has never been live-verified.

We chose the **full slice** (both halves) with the user supplying credentials for the auth
live-verify. Per the full-throttle / no-deferrals posture, the runtimes are installed
in-slice (the Slice-18 "install it ourselves" pattern) and everything is live-verified.

## 2. Locked design decisions (from the 2026-07-05 brainstorm)

1. **Scope = full slice.** Runtimes + remote-auth in one slice. I install LM Studio +
   llama.cpp in-slice; the user mints a `GITHUB_PAT` and designates one OAuth remote MCP
   target (primary: **Linear**, `https://mcp.linear.app/mcp`) for the live handshake.
2. **Context = load-time dynamic, as a per-runtime capability.** OpenAI-compatible `/v1`
   cannot take a per-request `num_ctx` (the Slice-23 wall). Honor live-computed context at
   **load granularity** via `RuntimeControl.warm(model, numCtx)` — but the mechanism, and
   whether it is possible at all, differs per runtime (see §4.2). No uniform "reload at new
   ctx" verb is assumed.
3. **MLX baked into the same unified base.** MLX, LM Studio, llama.cpp all share one
   managed-runtime base (`src/runtime/managed-openai-compatible.ts`); MLX is **rewritten**
   from today's no-op adapter into a first-class managed runtime with full process
   supervision. Its context, however, stays **model-defined** (mlx_lm.server has no context
   flag — validated; §4.2). A new `RuntimeKind.LlamaCpp` is added.
4. **Lifecycle = full supervision.** The framework spawns / health-checks / reloads / stops
   the server processes itself (port allocation, PID tracking, graceful shutdown, crash
   handling), wrapping the Slice-21 reliability primitives (`withWallClock`, breaker).
5. **OAuth token store = 0600 gitignored file** (`~/.config/ai/mcp-tokens.json`), separate
   from `.mcp-approvals.json`. Encryption / keychain is deliberately **left for the locked
   Slice-35 security-hardening slice**; a clean seam is left for it.
6. **LM Studio driver = `@lmstudio/sdk`** (official TypeScript SDK). This is the first new
   npm dependency since Slice 14's zero-new-deps streak — chosen for robustness over parsing
   `lms` CLI output. Recorded as a conscious deviation.
7. **OAuth registration = DCR/CIMD-first.** Per MCP auth spec 2025-11-25, client-id
   registration priority is pre-registered → **CIMD** → **DCR** → prompt, so we need **no
   preconfigured client-id** for DCR-capable servers. The **`resource` param (RFC 8707) is
   MUST** and is the classic silent-401 footgun — enforce it. AS discovery is via RFC 9728
   (protected-resource metadata) + RFC 8414 / OIDC discovery. The `@ai-sdk/mcp`
   `OAuthClientProvider` implements the actual PKCE/exchange/refresh handshake; we supply the
   plumbing around it.

## 3. Web-validation summary (2026, sourced)

| Runtime | Context control | Health | Process model | Install |
|---|---|---|---|---|
| **llama-server** | `-c/--ctx-size N` (relaunch to change) | real `GET /health` (503→200) | one model / process | `brew install llama.cpp` |
| **LM Studio** | `lms load --context-length N` / SDK `contextLength` (daemon stays up; unload+load to change) | none → poll `/v1/models` (or `lms ps`) | persistent daemon, multi-model | cask + `lms` CLI + `@lmstudio/sdk` |
| **mlx_lm.server** | **none** — context is model-config-defined; only `--max-tokens` caps output | none → poll `/v1/models` | per-request `model` switch | already installed (S18) |

- **MCP OAuth (spec 2025-11-25):** OAuth 2.1 + PKCE S256 (MUST); RFC 9728 protected-resource
  metadata (MUST) + RFC 8414/OIDC discovery (MUST); CIMD preferred, DCR fallback; `resource`
  param RFC 8707 (MUST); loopback-redirect CLI pattern (localhost callback + `open` browser).
- **Live-verify targets:** Linear `https://mcp.linear.app/mcp` (OAuth 2.1 + DCR, public, no
  license gate — **primary**); GitHub `https://api.githubcopilot.com/mcp/` (dual-auth: PAT
  simplest smoke test, OAuth needs Copilot license); Sentry/Notion/Atlassian as alternates.

## 4. Half A — Managed OpenAI-compatible runtimes

### 4.1 The shared base

New `src/runtime/managed-openai-compatible.ts` — a factory
`createManagedRuntime(strategy: RuntimeStrategy): Runtime` implementing the existing
`Runtime` interface (`src/runtime/runtime.ts:20`). It owns the full server lifecycle and
delegates the runtime-specific bits to a thin **strategy**:

```ts
type RuntimeStrategy = {
  kind: RuntimeKind;
  detect(): Promise<boolean>;              // binary/app present?
  ensureServer(): Promise<ServerHandle>;   // spawn (or attach to) the daemon/process
  loadModel(h: ServerHandle, model: string, numCtx?: number): Promise<void>; // context capability lives here
  unloadModel(h: ServerHandle, model: string): Promise<void>;
  health(h: ServerHandle): Promise<boolean>;
  baseUrl(h: ServerHandle): string;        // OpenAI-compat /v1 base
  contextCapability: 'relaunch' | 'reload' | 'fixed'; // llama.cpp | lmstudio | mlx
};
```

The base provides: process spawning + PID tracking, port allocation, health-poll with a
bounded timeout (Slice-21 `withWallClock`), reuse-if-already-serving-`(model, ctx)`, graceful
shutdown on process exit / SIGTERM, and `createModel(decl) = createOpenAICompatible({ baseURL })
(decl.model)` (reusing MLX's proven approach). It maps directly onto `RuntimeControl`
(`isInstalled`→`detect`, `warm`→`ensureServer`+`loadModel`, `unload`→`unloadModel`,
`listLoaded`, `getModelMax` from `/v1/models`, `getModelKvArch`→undefined, `embed`→llama.cpp
`/v1/embeddings` where available else throw).

### 4.2 Per-runtime strategies (thin)

- **llama.cpp** (`contextCapability: 'relaunch'`): `ensureServer`+`loadModel` spawn
  `llama-server -m <gguf> -c <numCtx> --port <p> --host 127.0.0.1` (and `--embeddings` for the
  embed path); `health` polls `GET /health` (503→200); changing model or ctx relaunches the
  process. New `RuntimeKind.LlamaCpp`. GGUF downloads (currently routed under Ollama via
  `HfGguf`) can now target this runtime through `kind-map.ts`.
- **LM Studio** (`contextCapability: 'reload'`): via `@lmstudio/sdk` — ensure the daemon is up
  (`lms server start` equivalent), `loadModel` loads with `{ contextLength: numCtx }`,
  changing ctx is unload+load without restarting the daemon; `health` polls `/v1/models` (or
  the SDK's list-loaded); base `http://localhost:1234/v1`.
- **MLX** (`contextCapability: 'fixed'`): `ensureServer` spawns `mlx_lm.server --model <m>
  --port <p>` (**upgrade** from today's assume-already-running); `loadModel` is a no-op w.r.t.
  context (mlx_lm has no context flag — **documented limitation**, `numCtx` ignored with a
  one-time warning); `health` polls `/v1/models`. This rewrites `src/runtime/mlx-server.ts`
  onto the shared base.

### 4.3 Context delivery fix

`select-hook.ts:87` currently drops `numCtx` for all non-Ollama runtimes. New behavior: the
computed `numCtx` is passed into `RuntimeControl.warm(model, numCtx)` for managed runtimes
(applied at load per the strategy's `contextCapability`); the per-call `num_ctx` stays
`undefined` (correct — it is applied at launch/load, not per request). For MLX
(`fixed`) the computed value is logged as advisory only. This makes llama.cpp + LM Studio
first-class on context and makes MLX honest about its limit.

### 4.4 Registration + types

- Add `RuntimeKind.LlamaCpp` (`src/core/types.ts:10`); extend `kind-map.ts`
  (`runtimeKindFor`, `downloadKindFor`) so llama.cpp GGUF downloads can pair with the
  LlamaCpp runtime instead of collapsing under Ollama.
- Register three `Runtime`s in `RUNTIMES` (`src/runtime/registry.ts:6`): `MlxServer`
  (rewritten), `LmStudio` (new), `LlamaCpp` (new).

### 4.5 Download-adapter live-verify

The `lmstudio` + `hf-fetch` download adapters (contract-tested with injected `fetch`) are
live-verified against the real installed runtimes: a real LM Studio daemon download and a
real llama.cpp GGUF fetch, closing the "live-verify deferred" note.

## 5. Half B — Remote MCP auth completion

### 5.1 Live OAuth provider

New `src/mcp/oauth-provider.ts` — a real `OAuthClientProvider` (the SDK does PKCE/exchange/
refresh; we supply the surrounding plumbing):

- **Token store** (`src/mcp/token-store.ts`): a 0600-perms, gitignored JSON file at
  `~/.config/ai/mcp-tokens.json`, keyed by server name; atomic temp+rename writes (mirroring
  `.mcp-approvals.json`'s pattern); stores access+refresh tokens + client information + code
  verifier. Encryption seam left for Slice 35. `.gitignore` updated.
- `redirectToAuthorization(url)`: `open` the system browser + a transient **loopback callback
  server** on an ephemeral `127.0.0.1` port with a `/callback` path; capture `?code&state`,
  verify `state`, shut the server down.
- `saveCodeVerifier`/`codeVerifier` (PKCE), `clientMetadata`/`clientInformation`
  (DCR/CIMD → typically no preconfigured client-id), `saveTokens`/`tokens` (→ token store).
- Enforce the **`resource` param** on authorization + token requests (the SDK path is
  configured/verified to include it).

### 5.2 Integration seam

Populate `deps.authProviders` in `withMcpRun` (`src/cli/with-mcp-run.ts`): for each mounted
entry with `auth.kind === OAuth`, construct + register a provider keyed by server name. Today
**no caller does this** (`mount.ts:41`), so remote OAuth always degrades — this is the single
wire that turns the contract-tested seam live. Extend `httpAuthSchema` (`src/mcp/types.ts:28`)
with optional `clientId` / `scopes` / `authorizationServer` fields for the non-DCR case.

### 5.3 GitHub-PAT

Code-complete already (static `Bearer ${GITHUB_PAT}`, `pack.ts:83`). Live-verify only: with a
user-supplied `GITHUB_PAT`, mount `https://api.githubcopilot.com/mcp/` and make a real
authenticated tool call.

## 6. Telemetry to emit (standing obligation)

- Runtime: `runtime.spawn` / `runtime.warm` spans (server start, model load, context applied
  vs requested), plus a `runtime.context.capability` attribute (`relaunch`/`reload`/`fixed`)
  so the MLX limitation is observable. New `ATTR.RUNTIME_*` keys following the existing
  pattern in `src/telemetry/spans.ts`.
- MCP auth: new `mcp.auth.*` events emitted through the existing `withMcpMountSpan` `record`
  callback (`spans.ts:496`) — `authenticated` / `auth-failed` / `token-refreshed` /
  `dcr-registered`, with a `mcp.server` attribute and **no secret values**.

## 7. Architecture-doc update (standing obligation)

- `docs/architecture.md` **§5 / §13** (runtimes): document the managed-runtime base, the three
  strategies, full supervision, and the per-runtime context-capability matrix (incl. the MLX
  fixed-context limitation). **§14** (MCP): the live OAuth handshake, token store, DCR/CIMD,
  the `resource` param, and the `deps.authProviders` wiring.
- Root `README.md`: status line + slice table row (Slice 26 ✅) + runtime/auth feature text.
- `docs/ROADMAP.md`: flip Slice 26 → ✅ shipped in the gap table, phase table, and sequence;
  update the "Alternate runtimes & the Mac Mini era" section (LM Studio + llama.cpp now full
  inference runtimes).
- The interactive architecture snapshot **Artifact** regenerated (runtime nodes updated,
  MCP-auth edge added, footer slice/test counts).

## 8. Testing strategy

- **Unit** (deterministic, default suite): the managed base + each strategy driven through an
  **injected process-spawner + `fetch`** seam (mirroring `mlx-server.test.ts` and the existing
  download-adapter tests) — spawn/health/reuse/shutdown/context-capability branches, with no
  live server. OAuth provider + token store tested with an injected clock/fs + a fake
  authorization server (PKCE challenge, callback, refresh, `resource` param presence).
- **Live-verify** (gated, opt-in env like `mlx.live.test.ts` / `RELIABILITY_LIVE=1`):
  - `ALTRUNTIME_LIVE=1`: real `generateText` through each managed runtime end-to-end;
    **assert the launched context matches the computed `numCtx`** (llama.cpp `-c`, LM Studio
    `contextLength`); MLX asserts process-managed + model-default context.
  - `MCP_OAUTH_LIVE=1`: drive the Linear OAuth handshake once (browser), assert token
    persistence + a second run reuses tokens without re-auth (refresh path).
  - `GITHUB_PAT` set: real authenticated GitHub MCP tool call.

## 9. Risks / honest limitations

1. **MLX context is fixed** (mlx_lm.server has no context flag) — reported, not papered over.
   MLX gains managed lifecycle + supervision but not load-time context.
2. **OAuth live-verify depends on the user** completing a browser login + minting a PAT — the
   one structurally external step (the user accepted this in scoping).
3. **`@lmstudio/sdk` is a new dependency** — first since Slice 14; conscious tradeoff.
4. **Full process supervision** adds a real robustness surface (port collisions, zombie
   processes, crash recovery) — mitigated by reusing Slice-21 reliability + explicit cleanup
   tests.

## 10. Out of scope (belongs to other locked slices)

- Encryption-at-rest / keychain for the token store → **Slice 35** (security hardening).
- AI SDK v7 / durable `WorkflowAgent` → **Slice 23** (held).
- Multimodal / voice / TUI → Slices 27–29.
