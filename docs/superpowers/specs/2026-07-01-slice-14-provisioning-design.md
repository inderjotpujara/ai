# Slice 14 — First-boot model provisioning + runtime-agnostic downloader (design)

**Date:** 2026-07-01
**Phase:** product line, post-Phase-B (recommended-sequence item 7)
**Branch:** `slice-14-provisioning`
**Status:** spec — awaiting user review before writing the implementation plan

---

## 1. Problem & goal

A fresh clone / new machine can't actually run the platform: it needs the router
(`qwen3.5:4b`), specialists (`qwen3.5:9b`), the embedder (`qwen3-embedding:0.6b`),
and now the verification judge (`bespoke-minicheck`) — all pulled manually today.
Worse, declaring a model in bootstrap without guaranteeing it's installed is the
exact seam that produced the Slice-13 selector crash (fixed defensively there; this
slice removes the root cause).

**Goal:** a guided first-boot experience that (1) detects the host's hardware, (2)
discovers models that *fit* it, (3) shows the user a fitting-set with sizes and asks
consent, (4) downloads the chosen models with a **live progress UI** (bytes / % /
speed / ETA), and (5) hands off to the existing `ensureReady` path — **across all
four runtimes** the framework targets (Ollama, LM Studio, llama.cpp, MLX), behind one
runtime-agnostic abstraction.

This is the deliberate, consent-first generalization of the "provision deliberately,
never speculatively pull, degrade-never-crash" contract
(`feedback-consent-before-model-pull`, `selector-providererror-fallback-bug`).

## 2. Scope decision (locked with user)

**Build the full runtime-agnostic core + all four download adapters. Live-verify every
runtime installable on this machine now; ship the rest with contract/mocked-progress
tests and an EXPLICITLY LOGGED deferred live-verify — never a silent skip.**

Machine reality (probed 2026-07-01): only **Ollama** is installed (v0.30.8, 24 GB RAM
→ ~7–8 GB model budget). So **Ollama is proven live end-to-end**; **LM Studio /
llama.cpp / MLX adapters are implemented + contract-tested with live-verify
logged-deferred** until those runtimes are installed. This honors "do all of them"
without a false completion claim against the live-verify-before-merge gate. See §12
and the **Deferred** section (§13) for exactly what we're leaving.

Validated research backing every mechanism below: `reference-provisioning-findings`
memory (three research passes, key endpoints verified live anonymously on 2026-07-01).

## 3. Architecture — the two-tier split *is* the design

Research surfaced one load-bearing fact: **who owns the download differs per runtime**,
and that difference is irreducible. Two runtimes own the download and expose progress;
two are thin over HuggingFace and we own the fetch. So the abstraction has two tiers.

```
CLI:  bun run provision            auto-detect hook (on chat/crew/flow/serve)
                     \             /
                   Provisioner  ── orchestrates: detect → discover → fit → consent → download → handoff
                        │
   ┌───────────────┬────┴───────────┬──────────────────┬─────────────────┐
 HardwareFit   CatalogSource    DownloadProvider     ConsentUI        ProgressUI
 (reuse S6)    (per runtime)    (per runtime)        (per-model)      (dep-free)
```

New subsystem: **`src/provisioning/`**. It *composes* on existing seams (does not
duplicate them): `detectHost()` / `liveBudgetBytes()` / `fitsBudget` / `footprint.ts`
(Slice 6 + resource), `CatalogSource` (Slice 6 discovery), `RuntimeControl` +
`runtimeFor()` (runtime layer), `ensureReady` (Model Manager), `src/telemetry/spans.ts`.

## 4. The unified progress protocol (the seam everything else consumes)

```ts
export enum DownloadPhase {
  Resolving  = 'resolving',   // fetching manifest / metadata / size
  Downloading = 'downloading',
  Verifying  = 'verifying',   // sha256 / digest / checksum
  Finalizing = 'finalizing',  // atomic rename / cache commit / install confirm
  Done       = 'done',
  Failed     = 'failed',
}

export type DownloadProgress = {
  modelRef: string;
  phase: DownloadPhase;
  bytesCompleted: number;
  bytesTotal: number | null;   // null until known (some sources learn it late)
  percent: number | null;      // derived, clamped monotonic
  speedBytesPerSec: number | null; // DERIVED (EWMA) everywhere except LM Studio SDK
  error?: string;
};

export type DownloadProvider = {
  readonly kind: ProviderKind;
  download(modelRef: string, opts: {
    onProgress: (p: DownloadProgress) => void;
    signal: AbortSignal;
  }): Promise<void>;
};
```

- **`percent` is clamped monotonic** (`max()` of prior) — Ollama's stream goes backwards
  on macOS; we never let the bar jump back.
- **`speedBytesPerSec` is derived** (EWMA over a ~1s tick) for every provider except the
  LM Studio SDK, which reports a rate natively. It is optional (`null` early).
- **`bytesTotal` is nullable** — known upfront for LM Studio + HF (tree/metadata) and
  Ollama (manifest sum), but may arrive late; the UI shows an indeterminate bar until set.

## 5. Download providers (four adapters, two tiers)

**Tier A — delegating (runtime owns fetch/cache/verify; we re-emit its progress):**

- **`OllamaDownloadProvider`** — `POST /api/pull {stream:true}`, parse NDJSON. Detect a
  download event by **presence of `digest`+`total`+`completed`** (not the status verb,
  which varies by version). Maintain a `digest → {completed,total}` map (replace, don't
  sum); aggregate = Σcompleted / Σtotal. Phases mapped from status (`pulling manifest`→
  Resolving, layer events→Downloading, `verifying sha256`→Verifying, `writing manifest`→
  Finalizing, `success`→Done). Wrapped by the **supervisor** (§8).
- **`LMStudioDownloadProvider`** — `@lmstudio/sdk` `download()` with `onProgress`
  callback (richest: bytes + native speed + status). Pinned SDK, wrapped in the adapter
  because the `repository.*` surface is undocumented/`unstable`. *Live-verify deferred.*

**Tier B — we own the download (thin over HuggingFace; one shared fetcher):**

- **`HuggingFaceFetcher`** (shared) — `@huggingface/hub` download of a target file/repo,
  streaming bytes via `for await (chunk of response.body)`; **adds SHA256** verification
  (llama.cpp/GGUF has no content hash). Range-resume via the library (HF always-resumes).
  `HF_TOKEN` env-fallback for rate limits, degrade to anonymous.
  - **`LlamaCppDownloadProvider`** — single GGUF file via the fetcher, then point
    llama.cpp at the local path. *Live-verify deferred.*
  - **`MlxDownloadProvider`** — whole safetensors snapshot via the fetcher (sum sizes
    across files into one progress number). *Live-verify deferred.*

## 6. Discovery — dynamic query, snapshot-backed (user choice + robustness floor)

Per-runtime `CatalogSource.listCandidates()` (extends the existing Slice-6 seam; today
it's installed-only — we implement real *downloadable* sources), **two-phase**:

1. **List** (one cheap call per source): populate `{modelRef, quant, downloads}`,
   leave `sizeBytes` lazy.
2. **Enrich size** only for candidates actually shown/selected.

| Runtime | List | Pre-download size (verified live) |
|---|---|---|
| Ollama | community JSON (chrizzo84/OllamaScraper) / snapshot | `registry.ollama.ai/v2/library/<model>/manifests/<tag>` → Σ`layers[].size` |
| HF (llama.cpp+MLX) | `/api/models?filter=gguf\|mlx&sort=downloads` | `/api/models/{id}/tree/main?recursive=true` → `size` (single GGUF) / Σ`size` (MLX snapshot) |
| LM Studio | SDK `searchModels()` | `getDownloadOptions().sizeBytes` (+ `fitEstimation`) — one call |

**Robustness floor:** a **committed snapshot catalog JSON** (top-N per backend,
pre-resolved sizes) is the *primary floor*; live query is the *enhancement*. Any
per-source failure (429 / 5xx / EOF / Ollama HTML drift / no LM Studio) → fall back to
that source's snapshot slice and continue. Size-enrich failure → snapshot size or
`null`, never block. (Refreshing the snapshot from live APIs is deferred automation — §13.)

## 7. Data flow (the `provision` experience)

`detectHost()` → live budget (`os.totalmem()` × tier-fraction [≤36 GB→0.66, >36 GB→0.75]
− OS reserve ≥8 GB; **never `freemem()`**) → each `CatalogSource.listCandidates()` →
**fit-filter** (`fitsBudget`, footprint incl. KV cache) + rank → **enrich sizes** for the
shown set → render **per-model selection UI** (each model + size + running total;
recommended subset pre-selected; user adjusts) → user confirms → **sequential** download,
one model at a time with a live `bytes / % / speed / ETA` bar → on completion **verify
install** (`isModelInstalled` / runtime check) → hand off to `ensureReady`. On this 24 GB
machine the fitting-set surfaces 7–9B Q4 candidates — the fit logic doing real work.

**Two entry points** (user choice): the standalone **`bun run provision`** command, and
an **auto-detect hook** — when any entry point (chat/crew/flow/serve) finds required
models missing, it offers to run the provisioning flow first (honoring consent).

## 8. Error handling — the Ollama supervisor + universal guards

Ollama already does 16-way parallel download + retry/backoff + partial-resume + sha256
internally, so our Ollama wrapper is a **supervisor**, not a downloader:

- **Disk-space preflight** (universal): sum selected sizes + headroom vs. free space on
  the models volume; refuse before starting (Ollama gives no early warning; sparse alloc).
- **Stall watchdog** (universal): no byte progress for 60–120 s → abort (`AbortController`)
  + idempotent re-issue with **jittered backoff** (base ~1 s, cap ~30–60 s, ≤6 attempts).
- **Digest/checksum-mismatch recovery**: distinct from transient — Ollama path = `rm` +
  delete partial blob + re-pull; treat as a normal path, not a crash.
- **Non-monotonic clamp** on `percent`; **EWMA** on speed.
- **Consent-before-pull** throughout; **degrade-never-crash** — a declined/failed model
  drops out, the rest proceed, and the run continues on whatever's installed (composes
  with the Slice-13 selector fallback). Do **not** trust `/api/pull` resume — track our
  own state and be ready to restart cleanly.

## 9. Terminal progress UI (dependency-free)

No TUI/progress-bar library exists in the repo and there's no y/n consent-prompt pattern.
Both are net-new, built **dependency-free** (mirrors the Slice-13 "no new npm dep" stance):
a small `src/provisioning/ui/` renderer writing to `process.stderr` with `\r` line-rewrite
for the live bar (bytes / % / speed / ETA, human-readable), and a minimal stdin y/n +
per-model selection prompt. Non-TTY / `CI` → plain line-per-update logging (no ANSI).
`AGENT_PROVISION_AUTO_YES` (env-fallback) for non-interactive consent, mirroring
`AGENT_VERIFY_AUTO_PULL`.

## 10. Telemetry to emit (standing rule)

New span `agent.model.provision` (mirrors `withModelLoadSpan`), plus per-model child
events. New `ATTR.*` keys: `provision.strategy` (delegating|hf-fetch), `provision.runtime`,
`provision.candidate_count`, `provision.selected_count`, `provision.bytes_total`,
`provision.bytes_downloaded`, `provision.model_outcome` (done|failed|declined|deferred),
`provision.deferred_verify` (bool), `provision.snapshot_fallback` (bool). Flows through
the existing `SpanExporter` seam → JSONL viewer + any OTLP backend for free.

## 11. Architecture-doc update (standing rule)

`docs/architecture.md` gains a **§13 Provisioning** section: the `src/provisioning/`
module map, the two-tier provider model, the discovery two-phase flow, the supervisor
guards, and the data-flow edges (CLI/hook → Provisioner → CatalogSource/DownloadProvider
→ RuntimeControl/ensureReady → telemetry). New nodes + edges added to both Mermaid
diagrams (module map + data-flow). Updated during implementation, audited at slice review.

## 12. Testing & live-verify plan

- **Unit / contract:** progress-protocol normalization per adapter against **recorded
  fixtures** (Ollama NDJSON incl. non-monotonic + multi-layer; HF tree/manifest JSON;
  LM Studio SDK progress objects). Fit-filter + size-enrich + snapshot-fallback logic.
  Supervisor guards (disk-preflight refusal, stall→re-issue, digest-mismatch→recover).
  Consent/selection UI (TTY + non-TTY). Deterministic, no network.
- **Live (this machine):** **Ollama end-to-end** — provision a small model on a clean
  models dir, watch the live bar, delete + re-provision, force a mid-pull abort to prove
  stall-recovery, prove degrade-never-crash on a bad ref. This is the merge gate.
- **Deferred-but-logged:** LM Studio / llama.cpp / MLX adapters ship green on
  contract/fixture tests; their **live-verify is explicitly logged as deferred** (in the
  SDD ledger, the ROADMAP, and a `provision.deferred_verify` telemetry flag) pending
  runtime install — never a silent skip.
- **Eval gate:** extend the in-repo pattern with a small provisioning golden set
  (fit-selection correctness for representative RAM tiers; size-parsing correctness).

## 13. Deferred — explicitly what we're leaving (recorded in ROADMAP too)

Nothing here is silently dropped; each is a conscious follow-on:

1. **Live-verify of LM Studio / llama.cpp / MLX adapters** — deferred until each runtime
   is installed on a test machine. Adapters ship implemented + contract-tested.
2. **Standing up LM Studio & llama.cpp as full *inference* runtimes** (`ProviderKind`s
   with chat/completions wiring) — out of scope; this slice adds their *download*
   providers only. Their inference wiring is a later slice (tracked under "Alternate
   runtimes" in ROADMAP).
3. **`gpustack/gguf-parser-go` adoption** — would give remote-header size + VRAM estimate
   across backends, but it's a Go binary. Deferred as a future enhancement; HF-tree +
   Ollama-manifest already give sizes and `footprint.ts` gives VRAM, so no new external
   dep now.
4. **Snapshot-catalog refresh automation** — the committed snapshot is the robustness
   floor; a periodic job that regenerates it from live APIs is deferred (manual/scripted
   refresh for now).
5. **Parallel multi-model downloads** — sequential-with-one-bar ships (clearer UX, avoids
   bandwidth contention); parallel multi-bar is a possible later enhancement.
6. **Live Metal `recommendedMaxWorkingSetSize` read** — we use the tier-fraction heuristic
   (≤36 GB→0.66, >36 GB→0.75) now; reading the live Metal cap is a refinement (matches the
   "compute live, don't hardcode" preference and is a small follow-on).
7. **Bumping bootstrap `bytesPerWeight` 0.56 → ~0.6** for Q4_K_M realism — noted; a
   conservative tweak to fold in with fit-tuning, not gated on this slice.

## 14. Task phasing (for the plan)

1. Unified progress protocol + `DownloadProvider` interface + dep-free progress/consent UI.
2. `OllamaDownloadProvider` (**live-verified**) + supervisor guards (preflight/stall/digest).
3. HardwareFit wiring + `CatalogSource` downloadable sources (Ollama + HF) + snapshot fallback.
4. `Provisioner` orchestration + per-model consent UI + `bun run provision` CLI + auto-detect hook.
5. `LMStudioDownloadProvider` + `HuggingFaceFetcher` (`LlamaCpp` + `Mlx` providers) — contract-tested, **deferred-verify logged**.
6. Telemetry (`agent.model.provision`) + **all-four docs surfaces** + provisioning eval gate.

## 15. Standing notes

- **Docs (hard line):** all four living surfaces updated when the slice ships —
  `architecture.md` (§13 + both Mermaid diagrams), root `README.md` (Status line, slice
  table row → ✅ Done, feature paragraph, Next line), `docs/ROADMAP.md` (flip the
  first-boot-provisioning marker + record deferrals — done at spec time per user request),
  and the interactive snapshot **Artifact** (new Provisioning node/edges, footer slice+test
  counts). Slice review audits doc *truth* against the diff.
- **Telemetry:** see §10 — not optional.
- **No hardcoding:** budgets/tier-fractions/sizes computed live; env vars fallback-only.
