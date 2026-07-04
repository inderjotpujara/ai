# Slice 18 — Debt wrap-up + MLX completion (design)

**Date:** 2026-07-03
**Branch:** `slice-18-debt-wrapup-mlx` (off `main`)
**Type:** Debt-discharge slice (one slice discharges ALL dischargeable-now deferred work logged through Slice 17)

## Motivation

The framework has accumulated deliberately-deferred, honestly-logged debt across Slices 14–17. The user directive (2026-07-03) is to **wrap up everything through the latest completed slice (17) in a single slice**, before moving on to Phase-D breadth (crew/workflow builder), and to **formalize this in the ROADMAP** — renumbering the downstream Phase-D breadth work to Slice 19+.

The center of gravity is **MLX**. Research this session (validated vs. latest — `/last30days` 2026-07-03) confirmed MLX is production-trending in 2026: **Ollama switched its Apple-Silicon inference engine to MLX** (announced 2026-03-30, preview; ~3× faster than its old llama.cpp backend), Apple pushed MLX as the local *agent* stack at WWDC26 (MLX-LM Server, multi-Mac distributed inference, M5 neural accelerators), and a third-party runner ecosystem (oMLX, rapid-mlx, vLLM-MLX) is forming. MLX is the **one deferred runtime we can fully live-verify now** because this dev machine is Apple Silicon. The honest counter-signal — MLX is Mac-only; llama.cpp stays the portable core — means we complete MLX but do **not** force-close the LM-Studio/llama.cpp *inference* runtimes (not installed).

## Goals

1. Split the overloaded `ProviderKind` so download-routing and inference-routing are distinct, honest concerns.
2. Make `hf-fetch` actually persist bytes to disk (it currently streams-and-discards) — with atomic writes and real integrity checking.
3. Raise the MLX inference runtime to Ollama's support bar (where the OpenAI-compat server allows) and make it selectable opt-in with graceful degradation.
4. Discharge the remaining Slice-14 provisioning polish, and the Slice-15/16 MCP + Slice-17 agent-builder debt.
5. **Live-verify** the MLX spine end-to-end (both direct `mlx_lm.server` and Ollama's MLX-backed path).
6. Formalize Slice 18 in all four doc surfaces + renumber downstream slices.

## Non-goals / stays deferred (blocked on external events — do NOT force-close)

- LM Studio / llama.cpp as full **inference** `RuntimeKind`s (tools not installed on the dev machine — LM Studio gets its **download** adapter wired, but inference is not stood up).
- Live official MCP registry query (`registry.modelcontextprotocol.io`) — API frozen until GA.
- Spec-2026-07-28 / MCP TS-SDK-v2 migration — that is the dedicated dep-upgrade slice (AI SDK v6 → v7 etc.).
- Codex heavy-lifting backup (Phase C).
- Execution dry-run / golden-task eval before agent activation — that is a *feature* (a future slice), not debt.

## Locked design decisions (2026-07-03 brainstorm)

### D1 — Split the enum (download vs inference)

Today `ProviderKind` is a two-member enum in `src/core/types.ts` (`Ollama | MlxServer`) used as the **same discriminator** across download (`provisioning/registry.ts` `providerFor`), catalog/discovery (`discovery/huggingface-mlx.ts`), **and** inference (`runtime/registry.ts` `runtimeFor`, `runtime/runtime.ts` `Runtime.kind`, `ModelDeclaration.provider`).

Split into:
- **Download** `ProviderKind` = `Ollama | HfGguf | HfSnapshot | LmStudio`
- **Inference** `RuntimeKind` = `Ollama | MlxServer | LmStudio`

**Plumbing (D1a):** two fields + a mapping helper.
- `ModelDeclaration` carries `runtime: RuntimeKind` (drives `runtimeFor` at inference).
- `Candidate` carries `provider: ProviderKind` (drives `providerFor` at download).
- `downloadKindFor(runtime, repoShape) -> ProviderKind` fills the mapping at discovery time (MLX repo → `HfSnapshot` + `MlxServer`; single-file GGUF → `HfGguf`/`Ollama` + `Ollama`; Ollama → `Ollama` + `Ollama`).

`createLmStudioProvider` (`src/provisioning/providers/lmstudio.ts`) is dead-from-registry today (only its own test imports it) → wire it into `providerFor` under `ProviderKind.LmStudio`.

### D2 — hf-fetch integrity posture

Atomic `.part` → `rename`. Verify the on-disk SHA256 against the HF LFS `oid` **when present** (FAIL + cleanup on mismatch); when no source hash exists (non-LFS files), **compute-and-record** the hash without gating. Degrade-never-crash; honest about what was actually verified. Reuse the already-present-but-unused `sha256File(path)` helper.

### D3 — MLX runtime selection

Opt-in / explicit (via the model registry's declared `runtime`, resolved by the selector). If the MLX server is unreachable, **degrade to the next available runtime (Ollama)** — log, never crash (mirrors the selector graceful-fallback contract). **No** automatic Apple-Silicon override / silent switch. MLX inference = `mlx_lm.server` OpenAI-compat at `MLX_BASE_URL` (default `http://localhost:1234/v1`).

## Workstreams

All land in one branch `slice-18-debt-wrapup-mlx`, staged commits per workstream, single PR. Sequence: **WS1 → WS2 → WS3** (the MLX spine, independently live-verifiable) then **WS4 / WS5** (smaller, self-contained fixes).

### WS1 — Enum split (Tier 1)

- Add `RuntimeKind` enum (`src/core/types.ts`); add `HfGguf | HfSnapshot | LmStudio` to `ProviderKind`.
- `Runtime.kind: RuntimeKind`; `runtimeFor(kind: RuntimeKind)`; `RUNTIMES` typed to runtime kinds.
- `ModelDeclaration.provider` → `ModelDeclaration.runtime: RuntimeKind`; `Candidate.provider: ProviderKind`.
- `downloadKindFor(runtime, repoShape)` helper (new, small, unit-tested).
- Update all consumers found in exploration: `provisioning/registry.ts` (`providerFor` switch + `catalogSourcesFor`), `runtime/registry.ts`, `discovery/huggingface-mlx.ts` (:63,:89), `discovery/huggingface-gguf.ts`, `provisioning/catalog/hf-catalog.ts` (:49 filter), `cli/select-hook.ts` (:47,:50), `resource/model-manager.ts` (:37), `discovery/build-registry.ts` (:40), `discovery/discover.ts` (:75), and the tests hardcoding `ProviderKind.MlxServer`.
- Wire `createLmStudioProvider` into `providerFor` under `ProviderKind.LmStudio`.

**Guardrail:** the split must not change existing Ollama behavior; every current Ollama path resolves to `runtime=Ollama, provider=Ollama`.

### WS2 — hf-fetch real disk download (Tier 1, largest code unit)

`src/provisioning/providers/hf-fetch.ts` + callers:
- **Introduce a destination path.** `download()` has no dest param today. Add a destination (new `download` opt) threaded from `provisioner.ts:117`; source the dir from `OLLAMA_MODELS`/`HF_HOME`/a cache dir (mirroring the `cli-deps.ts:13` free-space probe). Env-var fallback only; never hardcoded.
- **`HfGguf`** (single-file `repo::file.gguf`): stream chunks to `<dest>/<file>.part`, hash, verify/record, `Finalizing` rename to final, `Done`.
- **`HfSnapshot`** (bare `repo`, MLX): the current code fetches `resolve/main/` (a directory URL) and never gets files. Fix: **enumerate the HF tree** (already fetched for sizing in `catalog/hf-catalog.ts`) and download each file atomically to `<dest>/<repo>/...`.
- **Integrity (D2):** capture `lfs.oid` in the tree fetch (today `TreeEntry` reads only `size`); verify-when-present else compute-and-record via `sha256File`.
- **Robustness:** `try/finally` unlink of `.part` on error/abort; add `withRetry` + `StallWatchdog` parity (the HF provider currently has neither; Ollama does).
- Emit the `Finalizing` phase (currently never emitted).
- Tests: extend `tests/provisioning/hf-fetch.test.ts` — assert file exists on disk with expected byte length, no `.part` remains, phase sequence includes `Verifying`/`Finalizing`, sha256 mismatch fails + cleans up, snapshot enumerates multiple files.

### WS3 — MLX runtime to Ollama's bar (Tier 1)

`src/runtime/mlx-server.ts` — close the six control-surface gaps where the OpenAI-compat server exposes the data:
- `getModelMax` / `getModelKvArch`: read from server model metadata where available; return `undefined` honestly where not (planner tolerates it).
- `pull`: attempt a real load/download via the server API if supported; else keep the clear "load it in the server" error (degrade, not crash).
- `warm` / `unload` / `listLoaded` sizes: best-effort against the server.
- `embed`: keep honestly unsupported (memory/verify CLIs stay Ollama-pinned).
- Fix `select-hook.ts:50` numCtx assumption so MLX gets an appropriate context config.
- Selection: opt-in via declared `runtime`; degrade to Ollama when `isAvailable()` is false (D3).

### WS4 — Provisioning polish (Tier 2)

`gguf-parser`-style remote-header sizing (or documented decision to keep HF-tree sizing) · snapshot-catalog refresh automation · parallel multi-model downloads (multi-bar) · live Metal `recommendedMaxWorkingSetSize` read + `bytesPerWeight` 0.56→~0.6 bump · wire the two dead telemetry ATTR keys (`PROVISION_RUNTIME`, `PROVISION_DEFERRED_VERIFY`) + `snapshotFallback` attr · remove dead per-attempt `AbortController` in `supervisor.ts` `withRetry` · lmstudio `bytesTotal:0`→`null`.

### WS5 — MCP + agent-builder debt (Tier 3 + 4)

MCP OAuth (`authProvider`) for remote servers · GitHub remote-HTTP live-verify (needs `GITHUB_PAT`) · interactive-consent TTY spot-check · `chat.ts maybeAutoProvision` stderr-only TTY tidy (unify with `interactiveTTY()`) · emit `MCP_TRANSPORT` attr · fix `addPackEntry` check-then-act race · stop false-rejecting legit `WITH…SELECT` CTEs in the sqlite read-only gate · wire `warnUnknownAgents` beyond `flow.ts` · agent-builder same-run auto-retry · agent-builder generating brand-new tool code.

## Error handling

Every new failure path degrades, never crashes: unreachable MLX server → next runtime; download failure → recorded in `result.failed`, loop continues; sha256 mismatch → fail that model + cleanup `.part`, continue; missing HF `oid` → compute-and-record (no gate); OAuth/PAT absent → contract-tested path stays logged-deferred.

## Telemetry to emit (standing note)

- Wire the already-defined-but-unset attrs: `PROVISION_RUNTIME`, `PROVISION_DEFERRED_VERIFY`, `MCP_TRANSPORT`, and set `snapshotFallback` truthfully (not hardcoded `false`).
- `agent.model.provision` span: add the download `ProviderKind`, verified-vs-computed hash outcome, and `.part`→final rename success.
- MLX runtime selection: emit which `RuntimeKind` was chosen and whether a degrade-to-Ollama occurred.

## Architecture-doc update (standing note)

- `docs/architecture.md`: §13 Provisioning (hf-fetch now download-complete; `HfGguf`/`HfSnapshot` split; `LmStudio` wired; integrity posture), the runtime section (`RuntimeKind` vs `ProviderKind`; MLX control surface; opt-in+degrade selection), MCP section (OAuth, `MCP_TRANSPORT`), and §18 agent-builder deferrals. Update the module map + data-flow diagrams for the enum split.
- Root `README.md`: Status line + slice table row (Slice 18 ✅) + MLX feature paragraph.
- `docs/ROADMAP.md`: flip the discharged items ✅ (Slice 18) across the gap/phase tables + recommended sequence; **renumber Phase-D breadth work to Slice 19+**; leave the explicitly-deferred items marked deferred with their reasons.
- Regenerate the interactive architecture-snapshot Artifact (footer slice/test counts; new/changed edges for the enum split + MLX runtime).

## Testing + live-verify

- Deterministic unit tests per workstream (TDD): enum-split mapping, hf-fetch disk-write/atomic/sha256/snapshot-enumeration, MLX control-surface, MCP OAuth wiring, sqlite CTE gate, etc.
- **Live-verify (both paths, per user directive):**
  1. Install `mlx-lm`; run `mlx_lm.server --model <mlx-community/repo> --port 1234`.
  2. Exercise WS2 end-to-end: real MLX snapshot download to disk (files present, hashes recorded/verified, no `.part`).
  3. Exercise WS3 end-to-end: inference through `mlx-server.ts` against the running server.
  4. Verify Ollama's MLX-backed path still works (regression guard).
  - New `tests/integration/mlx-available.ts` gate (model-aware, mirroring `ollama-available.ts`); expand `tests/integration/mlx.live.test.ts` beyond the trivial list check.
- Pre-merge gate: `bun run docs:check && bun run typecheck && bun run lint` then `bun test` (full `bun run check` >2min). Adversarial task reviews + whole-branch final review (per the plan-sample-code rigor lesson).

## Sequencing / deliverables

WS1 → WS2 → WS3 (MLX spine; live-verify checkpoint) → WS4 → WS5 → docs (all 4 surfaces) + Artifact + SDD ledger. One PR at the end. Staged commits per workstream.
