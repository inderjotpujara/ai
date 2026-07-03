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
