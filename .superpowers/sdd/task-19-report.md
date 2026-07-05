# Task 19 report — Slice 26 documentation sweep

STATUS: complete. All four hard-line doc surfaces updated and audited claim-by-claim against the shipped code (not the task brief). `bun run docs:check` PASSES. No `src/**` files touched — only `README.md`, `docs/ROADMAP.md`, `docs/architecture.md`. Left unstaged/uncommitted for the controller (Task 20) to review, commit, update the SDD ledger, and regenerate the Artifact snapshot.

## Files changed

- `/Users/inderjotsingh/ai/docs/architecture.md`
- `/Users/inderjotsingh/ai/README.md`
- `/Users/inderjotsingh/ai/docs/ROADMAP.md`

## What I verified against code before writing (read, not assumed)

- `src/core/types.ts` — confirmed `RuntimeKind.LlamaCpp` added; `ProviderKind` unchanged.
- `src/core/kind-map.ts` — confirmed `downloadKindFor` now maps `LlamaCpp → HfGguf`.
- `src/runtime/managed-openai-compatible.ts` — confirmed `createManagedRuntime(strategy, deps)`, `ContextCapability = 'relaunch'|'reload'|'fixed'`, `breakerFor('runtime:'+kind)`, `/models` reads for `listLoaded`/`getModelMax`, `RuntimeStrategy.launch`/`daemonLoad`/`daemonUnload`.
- `src/runtime/process-supervisor.ts` — confirmed spawn + health-poll + `withWallClock` timeout + `SIGTERM` kill; fresh-port-per-relaunch comes from the caller's `portAlloc` in `managed-openai-compatible.ts`'s `freePort()`.
- `src/runtime/strategies/llamacpp.ts`, `strategies/mlx.ts`, `strategies/lmstudio.ts` — confirmed exact `contextCapability` per runtime, the `-hf`/`-m` branching logic, the `@lmstudio/sdk` lazy-client rationale (the file's own doc comment explains the eager-WebSocket-log problem, which I echoed in architecture.md), and LM Studio's `daemonLoad`/`daemonUnload` (no `launch`).
- `src/runtime/mlx-server.ts` — confirmed the external-baseUrl-vs-spawn branch: `createMlxServerRuntime` uses `externalServerStrategy` (no-spawn `daemonLoad`) when `MLX_BASE_URL`/`deps.baseUrl` is set, else falls through to the shared `createManagedRuntime(mlxStrategy, ...)` spawn path. This directly falsified the OLD architecture.md line "server owns lifecycle" as a blanket claim — corrected in §5 and §6 to describe both paths.
- `src/runtime/registry.ts` — confirmed all 4 runtimes registered (`ollamaRuntime`, `mlxServerRuntime`, `llamaCppRuntime`, `lmStudioRuntime`).
- `src/cli/select-hook.ts` — confirmed the new `if (rt.kind !== RuntimeKind.Ollama) await rt.control.warm(...)` block via `git diff main...HEAD` (new on this branch), and that the returned `numCtx` is still Ollama-only.
- `src/telemetry/spans.ts` — confirmed `RUNTIME_KIND`/`RUNTIME_CONTEXT_CAPABILITY`/`RUNTIME_CONTEXT_REQUESTED`/`RUNTIME_CONTEXT_APPLIED`/`RUNTIME_WARM_OUTCOME` + `withRuntimeSpan`, and `MCP_AUTH_OUTCOME`/`MCP_AUTH_KIND` + `withMcpMountSpan`'s `recordAuth` callback. Used `git log --all -S` to confirm both are new **on this branch** (commits `25c22da` runtime spans, `e05c34b` mcp.auth.* events), not pre-existing.
- `src/provisioning/providers/lmstudio.ts` — confirmed the poll URL is `/api/v1/models/download/status/${job.job_id}`, matching the brief's claimed fix.
- `src/mcp/token-store.ts`, `loopback.ts`, `oauth-provider.ts` — read in full; documented the exact method surface (`tokens`/`saveTokens`/`codeVerifier`/`saveCodeVerifier`/`state`/`saveState`/`storedState`/`clientInformation`/`saveClientInformation`/`authorizationServerInformation`/`saveAuthorizationServerInformation`/`redirectToAuthorization`/`waitForRedirect`), the 0600/atomic-write behavior, and why `oauth-provider.ts` implements its own loopback listener rather than reusing `awaitOAuthRedirect` (a provider's redirect+callback must share one bound port across two separate SDK calls).
- `src/mcp/client.ts` — confirmed `connectMcpClient`'s `UnauthorizedError` → `waitForRedirect()` → `auth()` → retry-once flow, and `hasWaitForRedirect`'s duck-typing guard.
- `src/cli/with-mcp-run.ts` — confirmed `buildAuthProviders(config)` was previously absent (the "OAuth always silently degraded" bug this slice fixes) and `recordAuthOutcomes` for the `static-key`/`token-reused`/`authenticated` telemetry values.
- `src/mcp/types.ts` — confirmed `scopes`/`clientId` were already present on `httpAuthSchema`/`HttpServerEntry['auth']` (pre-existing, not new fields to document as new).
- `scripts/docs-check.ts` — read to confirm it only enforces living-doc presence/links + per-subsystem-directory mention in architecture.md (no new top-level `src/` directory was added this slice, so no new subsystem-coverage requirement — `strategies/` nests under `src/runtime/`, already documented).

## Claims I could NOT independently verify (flagged, not blocking)

- **Exact test count** — resolved: I ran the full suite myself once it wasn't blocking anything else: `bun test` → **897 pass / 18 skip / 0 fail** (2008 `expect()` calls, 219 files, 223s). Close to but not identical to the brief's "~898/17" estimate (off by one on both pass and skip — plausibly one more/different gated live test skip in this environment). I did not embed this number in any doc (none of the three needed a hardcoded count), so no edit was needed there; passing it along here for Task 20's Artifact-footer regeneration.
- **Stale code comment I did NOT touch** (out of scope — it's `src/**`, not a doc, and the brief said not to touch code): `src/mcp/types.ts`'s `McpAuthKind` JSDoc still says *"Live OAuth token exchange is deferred (contract-tested only — see docs/architecture.md §14)"*. That's no longer true as of this slice. Flagging for the controller or a follow-up commit to fix as a one-line comment update.
- **The 3 gated live suites** (`ALTRUNTIME_LIVE`, `MCP_OAUTH_LIVE`, `GITHUB_PAT`) — I did not re-run them myself (no installed llama-server/LM Studio/real GitHub PAT/Linear OAuth app in this docs-only task's environment). I narrated the brief's stated live-verify results (llama.cpp `/props` n_ctx=8192, LM Studio ctx=4096, MLX confirmed fixed, Linear 47 tools + token-store reuse with no browser, GitHub PAT) as given, the same way architecture.md's existing "Live-verify" subsections for other slices narrate a slice's own live pass rather than being independently re-run by a later docs task.

## docs:check result

```
$ bun run scripts/docs-check.ts
✔ docs-check: living docs present + linked; every src subsystem documented.
```
Ran clean after every edit round (checked 4 times through the sweep, and once more at the end).

## Section-by-section summary of edits

### `docs/architecture.md`

- **§2 System map**: added 5 new mermaid nodes to the `RT` subgraph (`managed`, `procsup`, `stratllama`, `stratmlx`, `stratlm`) and 3 to the `MCP` subgraph (`mcpoauth`, `mcptokens`, `mcploopback`), plus ~13 new edges wiring them into the existing graph (`reg --> stratllama/stratlm`, `stratllama/stratmlx/stratlm --> managed`, `managed --> procsup`, `managed --> relbreaker`, `mlx --> stratmlx`, `selhook --> reg`, `mcpclient --> mcpoauth --> mcptokens`/`mcploopback`). Verified bracket/subgraph/end counts balance (159/159 brackets, 20/20 subgraph-end pairs) since mermaid isn't linted by tooling.
- **§2 layer table**: rewrote the **Runtime** row (4 adapters, managed base, process-supervisor, corrected mlx-server.ts description) and the **Tools/MCP** row (added the live-OAuth summary).
- **§5 "Discovery & runtimes"**: rewrote the section header + opening paragraph (4 adapters, not "Ollama + MLX"); added a new **"Managed runtimes — shared base + per-runtime strategy"** paragraph with a `contextCapability` table (relaunch/reload/fixed); added **"Context delivery, end to end"** describing the new `select-hook.ts` `warm()` call; rewrote the **MLX runtime** paragraph to correct the stale "server owns lifecycle" claim (now correctly scoped to the external-baseUrl path only) and describe the Slice-26 rewrite onto the managed base; extended the **"Download vs inference"** paragraph for `LlamaCpp → HfGguf`; added a **LM Studio download adapter fix** paragraph; added a new **"### Runtime telemetry (Slice 26)"** subsection describing `withRuntimeSpan` + all 5 `RUNTIME_*` attrs; updated the **Four axes** table's `RuntimeKind` row.
- **§6 "Why Ollama"**: fixed the stale "can slot behind the same interface" framing (llama.cpp/LM Studio/MLX already do, not hypothetically).
- **§14 MCP section**: updated the `mount.ts` bullet (Slice-18-wiring → Slice-26-live), added 3 new bullets for `oauth-provider.ts`/`loopback.ts`/`token-store.ts`, rewrote the `client.ts` bullet to describe the completed handshake; added a new **"MCP auth telemetry"** paragraph inside the existing Telemetry subsection; added a new **"### Live OAuth (Slice 26)"** subsection narrating the `buildAuthProviders` bug fix + the full handshake flow + token-store persistence; corrected the stale "GitHub not live-verified" closing line and added a new **"### Live-verify (Slice 26 — OAuth + GitHub-PAT)"** subsection.

### `README.md`

- Top blurb (`> Where this is going`): added the Slice 26 sentence, updated the "Next" pointer to Slice 24 (daemon) since Slices 22/23 are deferred/held, not next-up.
- **Status/Previously blockquote**: promoted a new detailed **Status: Slice 26** paragraph (runtime + OAuth narrative, live-verify results, gated-test env vars); compressed the old Slice-21 Status paragraph down into the new **Previously: Slice 21** slot (verbatim content, just retitled), and folded the old detailed Slice-20 paragraph into a short one-liner appended to the "Also shipped" tail (matching how Slices 19/18/17/etc. are already summarized there). Also corrected the Slice-14 mention inside that rollup ("live-verify completed in Slice 26").
- **Slice status table**: added row **26** (following the existing verbose-row convention used for Slices 18/19/20/21); updated the **Next (product line)** row to reflect Slice 24/25 as next, Slice 22/38 deferred, Slice 23 held.
- **"What it does (today)"**: added a new **Slice 26** paragraph after the existing Slice 20 paragraph (note: Slice 21 itself has no such paragraph — reliability wasn't given one either — so this isn't strictly required by precedent, but I added it since Slice 26 changes user-facing behavior: which runtimes actually run inference, and live remote-MCP OAuth).
- **Project structure table**: updated the `src/runtime/` row (4 adapters + managed base + process-supervisor) and `src/mcp/` row (added `oauth-provider.ts`/`token-store.ts`/`loopback.ts`, corrected `client.ts` description).
- **"Why Ollama (and where llama.cpp fits)"**: fixed the stale "if we ever need... we can add a raw llama.cpp-server or MLX-server adapter" framing — now describes them as already shipped (Slice 26) alongside LM Studio.

### `docs/ROADMAP.md`

- **Recommended-sequence item 17**: flipped from a pending bullet to `✅ shipped, Slice 26` with the full narrative (managed base, 3 strategies, live-verify results, OAuth completion).
- **"Alternate runtimes & the Mac Mini era"** section: rewrote the blockquote intro (Slice 14 → 18 → 26 arc) and all 3 per-runtime bullets (MLX/LM Studio/llama.cpp) to `✅ shipped` status, keeping the honest MLX-fixed-context caveat visible.
- **Slice 14 follow-ons**: flipped the two still-outstanding bullets ("Live-verify the LM Studio/llama.cpp download adapters", "Stand up LM Studio & llama.cpp as full inference runtimes") to `~~strikethrough~~ ✅ shipped (Slice 26)`, matching the existing convention for resolved Slice-14 debt items in the same list.
- **Slice 15 follow-ons**: flipped "OAuth for remote servers" and "GitHub remote-HTTP live-verify" to `~~strikethrough~~ ✅ shipped`, same convention.
- Did **not** touch the user's own backlog rows 31–38, the gap table (n8n/CrewAI concept table — Slice 26 is a debt/completion slice, not a new product-line capability, so it has no natural row there, consistent with how Slices 16/18 also got no gap-table row), or any Slice 24/25 status (those remain not-yet-shipped, unaffected by Slice 26 landing out of numeric order).

## Artifact (interactive snapshot) — node/edge/footer changes needed for Task 20

Not a repo file — noting what the controller's regeneration needs, mirroring the mermaid changes above:
- **New nodes**: Runtime subsystem — `managed-openai-compatible.ts`, `process-supervisor.ts`, `strategies/llamacpp.ts`, `strategies/mlx.ts`, `strategies/lmstudio.ts` (5 nodes, inside the existing Runtime subsystem box). MCP subsystem — `oauth-provider.ts`, `token-store.ts`, `loopback.ts` (3 nodes, inside the existing MCP subsystem box).
- **New edges**: registry → llama.cpp/LM Studio strategies; the 3 strategies → the managed base; managed base → process-supervisor + the reliability circuit breaker; MLX adapter → its strategy; select-hook → runtime registry; MCP client → oauth-provider → token-store + loopback.
- **Footer**: bump the slice count to include Slice 26 and update the test-count figure once Task 20 has the final `bun test` number (deliberately not blocked on here per the brief).
