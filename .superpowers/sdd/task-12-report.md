# Task 12 Report: Live verification + Slice 6 documentation

## Status
DONE — all steps completed, commit created.

## Commit hash
`a1468db` — "test(discovery): live discover + MLX verify + Slice 6 docs"

## Test summary (full suite)
`bun test` across 48 files: **120 pass · 11 skip · 0 fail · 224 expect() calls**

- `discover.live.test.ts` — **PASSED** (machine was online; HF reachable; ≥1 GGUF candidate found + catalog written; no pull triggered)
- `mlx.live.test.ts` — **SKIPPED** (no MLX server running at localhost:1234)
- All other integration tests (Ollama live, orchestrator, selection, fetch-mount, model-manager) — **SKIPPED** as before (no Ollama)
- All unit tests — **PASSED** (120 total)

Typecheck: clean (tsc --noEmit exit 0)
Lint: exit 0 (4 pre-existing `noNonNullAssertion` warnings in existing discovery test files, not introduced by this task; one formatter issue in discover.live.test.ts was fixed by `bunx biome check --write`)

## Files changed
- Created: `tests/integration/discover.live.test.ts`
- Created: `tests/integration/mlx.live.test.ts`
- Modified: `README.md` (Slice 6 status paragraph + discovery paragraph + roadmap table updated)
- Modified: `docs/architecture.md` (new §5 Discovery & runtimes; old §5/6/7 renumbered to §6/7/8/9; live test coverage entries added)
- Modified: `docs/ROADMAP.md` (Slice 6 moved to Shipped; new Committed follow-ons section with Slices 7-11 + Ollama-native-MLX + BFCL; recommended priority updated)

## Concerns
None. The brief's exact test code was used verbatim (modulo biome auto-formatting the host object literal across multiple lines for the line-length rule).

---

## Final-review fix wave

### Status
DONE

### Commit hash
`c3e5be3` — "fix(slice-6): route models by runtime + chat selects installed-only + review minors"

### Verify results
- **Typecheck:** `bun run typecheck` → clean (exit 0, no diagnostics)
- **Lint:** `bun run lint` → exit 0, 0 warnings (only the pre-existing biome.json deprecation INFO remains)
- **Tests:** `bun test` → **124 pass · 11 skip · 0 fail** · 229 expect() calls across 48 files

### Fixed items

- **I-1:** `src/cli/select-hook.ts` — replaced `createOllamaModel(decl)` with `runtimeFor(decl.provider).createModel(decl)`; `numCtx` returned only for `ProviderKind.Ollama` (undefined for MLX). Added a fourth test in `tests/cli/select-hook.test.ts` that drives an MlxServer decl through the hook and asserts model is truthy and numCtx is undefined.
- **I-2:** `src/discovery/build-registry.ts` — added injectable `isInstalled?: (decl: ModelDeclaration) => Promise<boolean>` dep (defaults to `runtimeFor(decl.provider).control.isInstalled`); catalog layer now filtered through `filterInstalledCatalog` which wraps each probe in try/catch (throw → exclude). Updated `tests/discovery/build-registry.test.ts`: injected `isInstalled: async () => true` into the existing merge test; added three new tests (false→excluded, true→included, throws→excluded/offline-safe).
- **(b):** `src/resource/model-manager.ts` — replaced `const d: ManagerDeps = { ...defaultDeps(), ...deps }` with `const d = deps` (deps already typed as `ManagerDeps`).
- **(c):** `src/discovery/huggingface-mlx.ts` — changed `capabilities: [Capability.Tools]` to `capabilities: detectTools(tmpl) ? [Capability.Tools] : []`.
- **(d):** `src/cli/discover.ts` — added `.catch((err) => { console.error(err); process.exitCode = 1; })` to the `main()` call; biome formatted it across three lines.
- **(a):** `tests/discovery/huggingface-gguf.test.ts` and `tests/discovery/huggingface-mlx.test.ts` — replaced `cands[0]!` non-null assertions with guarded `const cand = cands[0]; if (!cand) throw new Error(...)`. `bun run lint` → 0 warnings.
- **(e):** `README.md` — discovery paragraph now reads "GGUF (and MLX, when a local MLX server is running)" to match the live capability.

## Live-test fix: GGUF footprint/quant

Found in LIVE testing of Slice 6: `candidateFor` in `src/discovery/huggingface-gguf.ts` matched a quant by a single filename (old `QUANT_RE` required the quant immediately before `.gguf`) and used that ONE file's size for the budget check, while the footprint used `gguf.total` (logical params) × bpw. For multi-shard / MoE / mixed-precision repos these diverge wildly — e.g. `unsloth/gemma-4-26B-A4B-it-GGUF` ranked #1 as "fits" because a single 1.2GB F16-named file matched, while the real model is ~26B (~60GB). Sharded GGUFs (`...-Q4_K_M-00001-of-00003.gguf`) weren't matched at all, so the pre-pull silently failed ("Pre-pulled: none").

**Fix A** (`src/discovery/huggingface-gguf.ts`): rewrote quant selection to be shard-aware, full-precision-excluding, and footprint-consistent with the Model Manager. Quant labels are now extracted from ANY position in the filename (handles `-00001-of-0000N` shards); F16/F32/FP16/BF16 are excluded; `mmproj`/`projector` files are skipped. Shards of the same quant are grouped and their sizes SUMMED (`lfs.size ?? size`). The chosen quant is the largest summed-bytes tier whose footprint fits the live budget, where footprint = `weightsBytes(summedBytes/1e9/bpw, bpw) + kvCacheBytes(MIN_CTX, 131072)` (`bpw = bytesPerWeightForQuant(quant)`) — the same basis the manager uses. `gguf.total` is no longer used for sizing; `gguf.chat_template` (tools) and `gguf.context_length` (maxContext) are retained. No fitting tier → repo skipped.

**Fix B** (`src/discovery/discover.ts` + `src/cli/discover.ts`): `DiscoverResult` now carries `pullFailed: {model, reason}[]`. The pre-pull catch records the failure instead of silently dropping it, and the CLI prints `failed-to-pull: <model>: <reason>` per failure alongside `Pre-pulled: <list or none>`.

**Verify:** typecheck clean; lint exit 0 / 0 warnings; `bun test` 133 pass / 1 skip / 0 fail. Commit `454ac94`. quant.ts exports and quant.test.ts unchanged/green; offline-safety preserved (`candidateFor` fully guarded, `listCandidates` never throws).

How chosen-quant + footprint now work: per repo, all `.gguf` files are bucketed by recognized quant token (full-precision and non-weight files dropped), each bucket's shard sizes are summed to the true on-disk weight size, and the candidate is built from the largest bucket whose manager-basis footprint (`summedBytes × 1.2` weights + KV at MIN_CTX) fits the live RAM budget — so `fileSizeBytes` and the fit check now reference the same real download, eliminating phantom #1 ranks.
