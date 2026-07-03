# Slice 18 · Task 4 Report — Thread `runtime`/`provider` through discovery + selection consumers (WS1 linchpin)

## Outcome: GREEN restored

- `bun run typecheck` → **clean (0 errors)**.
- `bun test` → **475 pass, 2 skip, 0 fail** (477 tests / 139 files). Live integration tests auto-skip.

## Key architectural decision (confirmed, not guessed)

`Candidate` now carries **both** kinds:
- `runtime: RuntimeKind` (inherited from `ModelDeclaration`) — which local engine runs inference.
- `provider: ProviderKind` (added explicitly) — which downloader fetches the weights.

This is load-bearing and cannot be derived from `runtime` alone: an Ollama-runtime
candidate can have download kind `Ollama` (registry pull) *or* `HfGguf` (single GGUF
file) — same runtime, different download provider. So `provider` must be stored, set at
discovery time via `downloadKindFor(runtime, shape)`. Matches the brief's stated intent.

## Changes

### Core / types
- `src/discovery/catalog-source.ts`: `HostCapabilities.runtimes` retyped `ProviderKind[] → RuntimeKind[]`; `Candidate` gains required `provider: ProviderKind` (download kind) alongside the inherited `runtime`.
- `src/core/kind-map.ts`: added `runtimeKindFor(provider): RuntimeKind` — the download→runtime inverse (HfSnapshot→MlxServer, LmStudio→LmStudio, Ollama/HfGguf→Ollama). One home for the mapping; used by snapshot-source + hf-catalog.

### Discovery (set both kinds)
- `huggingface-mlx.ts`: decl `runtime: MlxServer`; candidate `provider: downloadKindFor(MlxServer,'snapshot')` (=HfSnapshot); host gate `host.runtimes.includes(RuntimeKind.MlxServer)`.
- `huggingface-gguf.ts`: decl `runtime: Ollama`; candidate `provider: downloadKindFor(Ollama,'gguf-file')` (=HfGguf).
- `discover.ts`: pull routing per brief — Ollama pre-pulls via `runtimeFor(RuntimeKind.Ollama).control.pull`; every other download kind fetches via `providerFor(c.provider).download(...)` (MLX → HF snapshot to disk). Dedup key stays on `c.provider` (download kind).
- `build-registry.ts`: installed decls set `runtime: rt.kind`; `defaultIsInstalled` + dedup key use `decl.runtime`.

### Provisioning
- `catalog/hf-catalog.ts:49`: filter now `kind === ProviderKind.HfSnapshot ? 'mlx' : 'gguf'`; candidates set `runtime = runtimeKindFor(kind)` + `provider: kind`.
- `catalog/ollama-catalog.ts`: candidate sets `runtime: Ollama` + `provider: Ollama`; host gate → `RuntimeKind.Ollama`.
- `catalog/snapshot-source.ts`: `runtime: runtimeKindFor(e.provider)` + `provider: e.provider`.
- `registry.ts:53`: stale comment `// MLX snapshot sum` → `// HF snapshot sum` (logged cleanup #1).
- `fit.ts` / `provisioner.ts`: unchanged code, now compiles (they read `c.provider`, the download kind — correct for per-download-kind recommend + `providerFor`).

### Selection / manager / misc consumers
- `cli/select-hook.ts`: `runtimeFor(decl.runtime).createModel`; `numCtx` gated on `decl.runtime === RuntimeKind.Ollama`; telemetry `provider: decl.runtime` (gen_ai.system = inference runtime).
- `resource/model-manager.ts:37`: `runtimeFor(decl.runtime).control`.
- `agent-builder/deps.ts`, `cli/memory.ts`, `cli/verify-runtime.ts`: `runtimeFor(RuntimeKind.Ollama)`.
- `memory/embed.ts`, `verification/deps.ts`, `models/qwen-fast.ts`, `models/qwen-router.ts`: `ModelDeclaration` literals set `runtime:` (was `provider:`).

### Tests
- Logged cleanup #2 — `tests/runtime/registry.test.ts`: restored the 3 dropped assertions (per-runtime `typeof control.isInstalled === 'function'` and `typeof createModel === 'function'`, plus `runtimeFor` throws on an unregistered kind) alongside the existing 2 `.kind` checks.
- Brief-listed hardcoded-kind tests: `huggingface-mlx.test.ts` (host runtimes → RuntimeKind; candidate MLX assertion → `cand.runtime`), `mlx-server.test.ts` (`.kind`/decl → RuntimeKind), `select-hook.test.ts` (`mlxDecl.runtime`).
- Additional fixtures fixed to restore green (in-scope "make it green"): ModelDeclaration literals renamed `provider→runtime`; Candidate literals gained `runtime` (kept `provider`); host `runtimes` arrays + `runtimeFor(...)` args → `RuntimeKind`. Files: build-registry, discover, catalog-cache, eval, fit, snapshot-source, provisioner, hf-fetch (`createHfFetchProvider(HfSnapshot)`), selection-notice, memory/embed, providers/ollama, detect-missing, resource/{model-manager,model-manager-kv,resolve-model,selector,selector-policy,warm-reuse}, integration/{memory,verification}.live.
- `huggingface-gguf.test.ts:49`: the one live failure caught by the full-suite gate — a GGUF single-file candidate's download `provider` is now `HfGguf` (not `Ollama`). Assertion split into `cand.runtime === Ollama` + `cand.provider === HfGguf`.

## Verification evidence
- Stray-reference scan: `grep -rn ProviderKind.MlxServer src/ tests/ models/` → none.
- typecheck: `tsc --noEmit` clean.
- suite: **475 pass / 2 skip / 0 fail**, 477 tests across 139 files.

## Concerns
- `discover.ts` now imports `providerFor` from `provisioning/registry.ts` (discovery→provisioning edge). No cycle (provisioning imports discovery *types* only). The default pull path for non-Ollama download kinds is not covered by a unit test (both discover tests inject `pullTop`); routing follows the brief's explicit guidance.

## Review-finding fixes (post-review pass)

### Finding 1 (Important) — discover.ts pre-pull routing regression — FIXED
The pull routing branch was keyed on the download `provider` (`provider === ProviderKind.Ollama`), not the
inference `runtime`. Regression: a `HfGguf`-provider candidate whose `model` is an Ollama-native
`hf.co/<repo>:<quant>` ref (the default sources are hfGguf/hfMlx, not the Ollama catalog) would route to
`providerFor(HfGguf).download(...)`, building a malformed `https://huggingface.co/hf.co/<repo>:<quant>/resolve/main/`
URL instead of pulling via the Ollama daemon (which natively resolves `hf.co/…` refs).

Fix — `src/discovery/discover.ts`:
- `DiscoverDeps.pullTop` signature changed from `(model, provider: Candidate['provider'])` to
  `(model, candidate: Candidate)` so the callback (and the default implementation) has the inference
  `runtime` available, not just the download kind.
- The default pull lambda now branches on `candidate.runtime === RuntimeKind.Ollama` (daemon pull via
  `runtimeFor(RuntimeKind.Ollama).control.pull`) vs. else `providerFor(candidate.provider).download(...)`.
- Removed the now-unused `ProviderKind` import.
- Call site now does `pull(c.model, c)` (passes the whole candidate).

Tests — `tests/discovery/discover.test.ts`: added two new tests exercising the **default** (uninjected)
`pull` implementation via `spyOn(globalThis, 'fetch')` (same seam already used in
`tests/resource/ollama-control.test.ts`):
- `'default pre-pull routes an Ollama-runtime candidate to the daemon, not providerFor'` — a
  `runtime: Ollama` / `provider: HfGguf` candidate with model `hf.co/foo:Q4_K_M` (the exact regression
  shape) asserts the single `fetch` call's URL contains `/api/pull` (Ollama daemon), not `huggingface.co`.
- `'default pre-pull routes a non-Ollama-runtime candidate to providerFor'` — a `runtime: MlxServer` /
  `provider: HfSnapshot` candidate asserts the `fetch` call's URL contains `huggingface.co` (HF
  DownloadProvider path).
Both new tests would have failed under the pre-fix code (first would have hit the malformed HF URL path
instead of `/api/pull`).

### Finding 2 (Minor) — hf-catalog stale doc comment — FIXED
`src/provisioning/catalog/hf-catalog.ts:42` (now :43): comment said `kind` = "which runtime consumes
these... MlxServer for MLX" — stale post-enum-split, since `kind: ProviderKind` is a **download** kind, not
a runtime. Reworded to: "kind = which download ProviderKind fetches these weights (e.g. HfSnapshot for
MLX); filter differs."

### Finding 3 (Minor) — select-hook telemetry field name — FIXED
`src/cli/select-hook.ts:41-42`: added an inline comment on the `provider: decl.runtime` telemetry field
clarifying it's legacy naming carrying the inference runtime (`gen_ai.system`), and that WS3 revisits this
hook. No rename (out of scope per the finding).

## Verification (post-fix)
- `bun run typecheck` → clean, 0 errors.
- `bun run test:file -- "tests/discovery/discover.test.ts"` → 4 pass, 0 fail, 11 expect() calls.
- `bun test` (full suite) → **477 pass, 2 skip, 0 fail**, 1009 expect() calls, 479 tests across 139 files
  (up from 475 pass due to the 2 new tests; no new failures).
- `bun run lint:file` on the 4 touched files → clean after `biome check --write` reformatted the new test
  file's imports/afterEach block to match project style.

Commit: `fix(discovery): route pre-pull by inference runtime (daemon for Ollama) + doc/comment cleanups`
