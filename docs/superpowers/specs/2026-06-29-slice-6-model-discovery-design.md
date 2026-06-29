# Slice 6 — Model Discovery + Multi-Runtime Foundation (design)

**Date:** 2026-06-29
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 5 (registry + selector + lazy binding), Slice 4 (Model Manager, live budget, footprint)
**Feeds:** Slice 7 (KV-cache quant), Slices 8–11 (vision · audio · video · uncensored mode)

---

## 1. Problem & goal

Today the registry is a **static, hand-curated bootstrap ladder** (`qwen3.5:4b` + `qwen3.5:9b`) hardcoded in `models/registry.ts`. "Always on the latest models per machine" is the north star and explicitly a **runtime behavior, never a code edit**.

Slice 6 makes model choice **discovered at runtime, per host**, and lays the **extensible foundation** for everything the system will ever run — not just this 24 GB laptop and not just GGUF/text. It is validated against **live mid-2026 HF + Ollama** facts (see §10).

This is a **forever, multi-machine, multi-modal system.** The architecture must hold every future capability as a first-class, pluggable dimension *now*, while the *build* is sequenced so each piece ships and is verifiable. Slice 6 builds the foundation + **text/tools on two runtimes (Ollama-GGUF and MLX)**; vision/audio/video and an uncensored mode are **designed-in seams** delivered in Slices 8–11.

### Locked decisions (from brainstorming)

1. **Offline-first.** Normal runs **never touch the network**. They read a cached catalog + locally-installed models + the verified bootstrap. Fully offline forever still works. Network is *optional enrichment*.
2. **`discover` command + auto-refresh-if-stale.** `bun run discover` does the live fetch on demand; a normal run auto-refreshes once **only if** the cache is missing/older-than-TTL **and** the network is up — otherwise it silently uses what it has. A failed/absent network is never an error on the chat path.
3. **Pre-pull at `discover` time; chat selects among *installed* models.** `discover` pulls the top-ranked fitting model(s) so they're resident. No surprise multi-GB download mid-conversation. The catalog still *lists* not-installed candidates (visible), but selection prefers installed.
4. **Four extensible axes** (the heart of the slice): **capability/modality**, **runtime**, **catalog source**, **content-policy**. All typed now; text/tools exercises them; the rest plug in.
5. **GGUF (Ollama) + MLX (dedicated MLX-server adapter) built now**, both for text/tools. MLX runs on *any* Apple Silicon via an OpenAI-compatible local server (LM Studio / vllm-mlx) — **not** gated by Ollama's >32 GB MLX-engine rule.
6. **Host-adaptive.** A host-capability detector (total RAM + reachable runtimes) decides which sources/runtimes apply; the live-budget fits-filter already scales model size to the host (24 → 64 GB picks bigger models automatically — inherent, not added).
7. **KV-cache quant is Slice 7** (a resource-manager budgeting multiplier, global `ollama serve` env). Discovery footprint just *consumes* the manager's `kvBytesPerToken`.

---

## 2. The four axes (extensible taxonomy — `src/core/types.ts`)

```ts
/** What an agent can require and a model can provide. Selector hard-filters on these. */
export enum Capability {
  Tools = 'tools',
  Vision = 'vision',   // image input        (exercised in Slice 8)
  Audio = 'audio',     // speech in/out      (Slice 9)
  Video = 'video',     // frames/clips       (Slice 10)
}

/** Which local runtime backs a model. */
export enum ProviderKind {
  Ollama = 'Ollama',          // GGUF via llama.cpp Metal (+ MLX engine on >32GB hosts, auto)
  MlxServer = 'MlxServer',    // MLX via a local OpenAI-compatible server (LM Studio / vllm-mlx)
}

/** Content moderation posture. Default-safe; uncensored gated behind a future mode (Slice 11). */
export enum ContentPolicy {
  Default = 'default',
  Uncensored = 'uncensored',
}
```

`ModelDeclaration` gains **optional** fields (all default-safe; existing decls/tests unaffected):

```ts
export type ModelDeclaration = {
  // ...existing: provider, model, params, role, capabilities?, footprint, maxContext...
  /** Moderation posture; absent = Default. */
  contentPolicy?: ContentPolicy;
};
```

`ModelRequirement` gains an **optional** policy allowance (default: disallow uncensored):

```ts
export type ModelRequirement = {
  role: string;
  requires: Capability[];
  prefer: PreferPolicy;
  /** If true, uncensored models are eligible. Default/absent = false (filtered out). */
  allowUncensored?: boolean;
};
```

The selector's hard-filter (`selectCandidates`) extends by one rule: **drop `ContentPolicy.Uncensored` candidates unless `req.allowUncensored === true`.** Everything else (capability filter, largest-that-fits, warm-aware) is unchanged.

---

## 3. Runtime registry (provider axis)

A runtime adapter turns a `ModelDeclaration` into an AI-SDK `LanguageModel` **and** owns its lifecycle hooks (install/warm/list/unload) so the Model Manager stays runtime-agnostic.

```ts
// src/runtime/runtime.ts
export type Runtime = {
  kind: ProviderKind;
  /** Is this runtime reachable on this host right now? (used by the host detector) */
  isAvailable(): Promise<boolean>;
  /** Build the AI-SDK model for a declaration. */
  createModel(decl: ModelDeclaration): LanguageModel;
  /** Lifecycle the manager drives (mirrors today's ollama-control surface). */
  control: {
    isInstalled(model: string): Promise<boolean>;
    pull(model: string): Promise<void>;
    warm(model: string, numCtx?: number): Promise<void>;
    unload(model: string): Promise<void>;
    listLoaded(): Promise<LoadedModel[]>;
    getModelMax(model: string): Promise<number | undefined>;
  };
};
```

- **`src/runtime/ollama.ts`** — wraps the existing `src/resource/ollama-control.ts` + `createOllamaModel`. This is a refactor: today's functions become this runtime's `control`/`createModel`. `ProviderKind.Ollama`. `isAvailable` = `GET /api/version` succeeds.
- **`src/runtime/mlx-server.ts`** — NEW. Targets a local OpenAI-compatible MLX server (LM Studio / vllm-mlx / `mlx_lm.server`) via an OpenAI-compatible AI-SDK provider pointed at `MLX_BASE_URL` (default `http://localhost:1234/v1`, configurable). `createModel` = openai-compatible model. `control`: `isInstalled`/`listLoaded` via the server's `/v1/models`; `pull` via the server's model-load/download API where supported, else a no-op + a clear "load it in LM Studio" message; `warm`/`unload` best-effort; `getModelMax` from model metadata or `decl.maxContext`. `isAvailable` = `/v1/models` reachable. Tool-calling uses the OpenAI `tools` schema (so target LM Studio / vllm-mlx, which support it reliably — *not* bare `mlx_lm.server`).

```ts
// src/runtime/registry.ts
export const RUNTIMES: Runtime[] = [ollamaRuntime, mlxServerRuntime];
export function runtimeFor(kind: ProviderKind): Runtime;            // lookup
export async function availableRuntimes(): Promise<Runtime[]>;       // filter by isAvailable()
```

The **Model Manager** is refactored to call `runtimeFor(decl.provider).control.*` instead of importing `ollama-control` directly — so it drives any runtime. (Slice-4/5 behavior is otherwise unchanged.)

> **New dependency (verify pin in the plan):** an OpenAI-compatible AI-SDK provider for the MLX server — `@ai-sdk/openai-compatible@^1` (or the openai provider with a custom `baseURL`). Pin verified at plan time, consistent with the project's locked-pins discipline.

---

## 4. Catalog source registry (source axis)

```ts
// src/discovery/catalog-source.ts
export type DiscoveryQuery = {
  budgetBytes: number;            // live budget — RAM-fit filter
  requires?: Capability[];        // e.g. [Tools]
  hostTotalRamBytes: number;      // host detector input
};

export type Candidate = ModelDeclaration & {
  repo: string;                   // 'unsloth/Qwen3.5-9B-GGUF'
  quant?: string;                 // 'Q4_K_M' (GGUF) | '4bit' (MLX)
  fileSizeBytes: number;          // chosen artifact size (≈ weights)
  downloads: number;              // popularity signal for ranking
  installed: boolean;             // resolved against the runtime at build time
};

export type CatalogSource = {
  name: string;                                   // 'hf-gguf' | 'hf-mlx'
  /** Hosts/runtimes this source applies to (host detector consults this). */
  appliesTo(host: HostCapabilities): boolean;
  listCandidates(q: DiscoveryQuery): Promise<Candidate[]>;
};
```

- **`src/discovery/huggingface-gguf.ts`** — the primary source. Two-phase, rate-limit-aware:
  1. List: `GET /api/models?filter=gguf&sort=downloads&direction=-1&limit=N`, restricted to a **trusted-publisher allowlist** (bartowski, unsloth, MaziyarPanahi, Qwen, lmstudio-community, …) — quality + safety guard, configurable.
  2. Per candidate: `GET /api/models/<repo>` → read the `gguf` block: `chat_template` (→ `Capability.Tools` if it contains tool markers), `total` (→ params), `context_length` (→ `maxContext`).
  3. `GET /api/models/<repo>/tree/main` → per-quant file sizes; **pick the best quant that fits** the budget (`quant.ts` map).
  4. Tag `contentPolicy` from repo name/tags (`abliterated`/`uncensored`/`dolphin` → `Uncensored`).
  - `appliesTo`: always (Ollama runs GGUF on every host).
- **`src/discovery/huggingface-mlx.ts`** — MLX source. Same list approach with `?library=mlx` / `mlx-community`, but **no `gguf` block**: read `config.json` (params, hidden size) + `tokenizer_config.json` `chat_template` (tool signal) per repo; sizes from the tree (safetensors shards). `provider: ProviderKind.MlxServer`.
  - `appliesTo`: only when an MLX runtime is reachable (host detector) — so on a laptop with no MLX server running, MLX candidates aren't surfaced.
- **`src/discovery/quant.ts`** — quant suffix → `bytesPerWeight` (Q4_K_M≈0.56, Q5_K_M≈0.70, Q6_K≈0.82, Q8_0≈1.06; MLX 4bit≈0.55, 8bit≈1.06) + `pickBestQuantThatFits(files, budget)`.

All HF calls live behind a small `src/discovery/hf-client.ts` (anonymous; optional `HF_TOKEN` env; respects the 500-req/5-min budget by paginating + capping candidate info calls to top-N; every call wrapped so a failure degrades gracefully).

---

## 5. Host detector + discovery pipeline + offline registry

- **`src/discovery/host.ts`** — `detectHost(): Promise<HostCapabilities>` = `{ totalRamBytes, liveBudgetBytes, runtimes: ProviderKind[] }` (reachable runtimes via each `Runtime.isAvailable()`). Drives `CatalogSource.appliesTo` and source selection.
- **`src/discovery/discover.ts`** — the pipeline (online, run by the command):
  ```
  host = detectHost()
  sources = SOURCES.filter(s => s.appliesTo(host))
  candidates = flat( await each source.listCandidates({budget, requires:[Tools], hostTotalRamBytes}) )
  → tool-capable filter → fits-budget filter → dedupe (by base-model identity across repos)
  → rank (downloads desc, then largest-that-fits) → top-N
  → writeCatalog(catalog.json)
  → pre-pull the top fitting model(s) per runtime (runtime.control.pull)
  ```
- **`src/discovery/catalog-cache.ts`** — read/write `model-images/catalog.json` (git-ignored, per-machine); `isStale(ttl)`; safe partial writes (never corrupt an existing catalog on failure).
- **`src/discovery/build-registry.ts`** — **offline-safe**, used by chat (zero network):
  ```
  buildRegistry() =
    BOOTSTRAP (qwen3.5:4b/9b)
    ∪ installed models (each reachable runtime's listLoaded/tags → ModelDeclaration)
    ∪ cached catalog candidates (if any)
    → dedupe by (provider, model) → ModelDeclaration[]
  ```
  If online + cache stale/missing, it may kick off **one** background refresh (non-blocking; result used next run) — but it always returns immediately from local data.

- **CLI:** `src/cli/discover.ts` (+ `discover` package script) runs the pipeline and prints a summary (found / fits / pulled / catalog path). `src/cli/chat.ts` swaps `registry: REGISTRY` for `registry: await buildRegistry()`.

---

## 6. Data flow

```
bun run discover (ONLINE):
  detectHost → applicable sources (hf-gguf [+ hf-mlx if MLX server up])
  → HF list(trusted) → per-repo gguf/config info (tool signal, params, ctx)
  → tree sizes → pick-quant → fits-budget + tool filter → dedupe → rank top-N
  → write catalog.json → pre-pull the top-ranked fitting model per runtime
    (count configurable, default 1; bootstrap rungs already present count as installed)

chat run (OFFLINE-SAFE, zero network):
  buildRegistry() = bootstrap ∪ installed(all runtimes) ∪ catalog.json  (deduped)
  → Slice-5 selector picks largest-that-fits among INSTALLED, honoring capability + contentPolicy filters
  → runtimeFor(decl.provider).createModel → manager.ensureReady → answer
  (cache stale + online → one non-blocking background refresh; offline/429 → use local)
```

---

## 7. Error handling (offline-first, never break the chat path)

- Every HF/network call is wrapped: failure (offline, 429, parse error, timeout) → log to stderr + fall back to cached catalog / installed / bootstrap. **Never throws on the chat path.**
- `discover` reports failures clearly and **never corrupts** an existing `catalog.json` (write to temp + atomic rename).
- An unreachable runtime (e.g. no MLX server) → that runtime contributes nothing; its sources don't apply. No error.
- Rate-limit (429) → back off, use partial/last-good catalog; suggest setting `HF_TOKEN`.

---

## 8. Affected files

**New**
- `src/runtime/runtime.ts` (port), `src/runtime/ollama.ts` (wraps existing control), `src/runtime/mlx-server.ts`, `src/runtime/registry.ts`.
- `src/discovery/catalog-source.ts`, `huggingface-gguf.ts`, `huggingface-mlx.ts`, `quant.ts`, `hf-client.ts`, `host.ts`, `discover.ts`, `catalog-cache.ts`, `build-registry.ts`.
- `src/cli/discover.ts`.

**Changed**
- `src/core/types.ts` — extend `Capability`; add `ProviderKind.MlxServer`, `ContentPolicy`; optional `contentPolicy` on `ModelDeclaration`; optional `allowUncensored` on `ModelRequirement`.
- `src/resource/selector.ts` — `selectCandidates` adds the content-policy filter (one rule).
- `src/resource/model-manager.ts` — drive lifecycle via `runtimeFor(decl.provider).control.*` instead of importing `ollama-control` directly.
- `src/cli/chat.ts` — `registry: await buildRegistry()`; build the select-hook over all runtimes.
- `models/registry.ts` — rename `REGISTRY` → `BOOTSTRAP` (clarifies it's the offline floor, not "the" list). **This touches the Slice-5 consumers that import `REGISTRY`** (`src/cli/chat.ts`, `tests/models/registry.test.ts`, `tests/cli/select-hook.test.ts`, `tests/resource/select-degrade.test.ts`, `tests/integration/selection.live.test.ts`) — each updated to `BOOTSTRAP` or to `buildRegistry()` as appropriate. Keep `models/registry.test.ts` asserting the bootstrap floor.
- `package.json` — `discover` script; new openai-compatible provider dep (pin verified in plan).
- Docs: README, `docs/architecture.md`, `docs/ROADMAP.md`.

**Refactor note:** moving `ollama-control` behind the `Runtime` port is the one structural change to existing code; it's mechanical and keeps the manager runtime-agnostic. The Model Manager keeps its **injectable `ManagerDeps`** (so existing unit tests that inject fakes still work unchanged); only the *default* deps change — instead of importing `ollama-control` directly, the default resolves lifecycle calls through `runtimeFor(decl.provider).control` per delegation. No behavior change for the Ollama path; existing Ollama live tests must stay green.

---

## 9. Testing

**Unit (mocked `fetch`/runtime, fixtures — no network, no Ollama, no MLX server)**
- `quant.ts`: suffix → bpw; `pickBestQuantThatFits`.
- `huggingface-gguf`: parse list + `gguf` block + tree fixtures → candidates; tool-capability via `chat_template` (±tools); contentPolicy tagging; trusted-author filter; fits-budget filter.
- `huggingface-mlx`: parse `config.json` + `chat_template` + tree → candidates.
- dedupe (same base model across repos), rank (downloads then size).
- `catalog-cache`: read/write round-trip; `isStale`; corrupt/missing → safe defaults.
- `build-registry`: merge bootstrap ∪ installed ∪ catalog, dedupe; **offline fallback** (sources throw → returns bootstrap+installed, no throw).
- `selectCandidates`: uncensored filtered out unless `allowUncensored`; capability filter incl. a Vision-tagged candidate excluded for a Tools-only requirement (proves the modality axis).
- `runtime/registry`: `runtimeFor`, `availableRuntimes` with mocked `isAvailable`.
- `mlx-server` runtime: `createModel` builds an openai-compatible model at the configured baseURL; `control` maps to `/v1/models` (mocked fetch).

**Live (opt-in, auto-skip)**
- `discover.live`: against real HF (skip if offline) → returns ≥1 tool-capable GGUF that fits + writes catalog + pre-pull works.
- `mlx.live`: skip unless an MLX server is reachable (`MLX_BASE_URL`); a tiny MLX model answers a tool prompt through the adapter.
- Existing Ollama live tests stay green (the runtime refactor must not regress them).

---

## 10. Validated mid-2026 facts (from research; cite in code comments)

- HF GGUF list: `GET /api/models?filter=gguf&sort=downloads&direction=-1` (anon OK). **Anon rate limit 500 req/5-min/IP** → paginate + cap + cache; optional `HF_TOKEN`.
- `gguf` block (`chat_template`, `total`, `context_length`) is on **`/api/models/<repo>`**, NOT the list → two-phase. File sizes via `/api/models/<repo>/tree/main` (or `?blobs=true`).
- Tool signal = `gguf.chat_template` contains `tools`/`tool_call` (reliable); HF tags are not.
- Pull GGUF via Ollama: `ollama pull hf.co/<repo>:<quant>` over `POST /api/pull` (existing `pullModel` already supports it).
- MLX: Ollama's MLX *engine* is **>32 GB-gated** (still true v0.30.10) and runs safetensors automatically there — no catalog change. A **dedicated MLX server** (LM Studio / vllm-mlx) runs MLX on any Apple Silicon with an OpenAI `/v1` API + reliable tool-calling → our `MlxServer` runtime targets it. Bare `mlx_lm.server` tool-calling is unreliable — prefer LM Studio / vllm-mlx.
- MLX HF discovery: `?library=mlx` / `mlx-community`; no `gguf` block → parse `config.json` + `chat_template`.
- BFCL quality scores: GitHub-only (not live) → ranking stays size/downloads-based; BFCL is an optional **offline** prior (future).

---

## 11. Future work (COMMITTED — carried into ROADMAP, nothing dropped)

The four-axis foundation has typed slots for all of these; each is its own brainstorm→spec→plan→build:

1. **Slice 7 — KV-cache quant** (resource manager): `kvBytesPerToken × {f16 1.0, q8_0 0.5, q4_0 0.25}`; global `OLLAMA_KV_CACHE_TYPE` + `OLLAMA_FLASH_ATTENTION=1` set by the serve script; default **q8_0** (near-lossless, ~2× context), **q4_0** opt-in with a **high-GQA guard** (Qwen is high-GQA → sensitive). Asymmetric K/V deferred until Ollama supports it.
2. **Slice 8 — Vision** (`Capability.Vision`): vision model discovery/run + a `read_image` tool.
3. **Slice 9 — Audio** (`Capability.Audio`): local Whisper STT + a TTS runtime → voice agent.
4. **Slice 10 — Video** (`Capability.Video`): frames/clips on vision + audio.
5. **Slice 11 — Uncensored mode** (`ContentPolicy.Uncensored`): curation + the `allowUncensored` toggle's UX + guardrails.
6. **MLX on >32 GB via Ollama's native engine** (auto for safetensors) — register an Ollama-MLX nuance when the Mac Mini lands.
7. **BFCL offline quality ranking**; richer multi-quant selection; non-Apple runtimes.

---

## 12. Out of scope for Slice 6

Actually running vision/audio/video models, the uncensored-mode UX, KV-cache-quant, BFCL ranking, and any non-Ollama/non-MLX-server runtime — all are typed seams here and built in the slices above.
