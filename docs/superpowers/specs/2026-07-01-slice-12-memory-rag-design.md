# Slice 12 — Memory/RAG datastore — design

**Date:** 2026-07-01
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 4 (Model Manager — `ensureReady`, live budget), Slice 5 (live model selection via `modelReq`/`onBeforeDelegate`), Slice 6 (runtime port + `/api/show` probes), Slice 7 (KV-cache sizing), Slice 8 (telemetry/spans), Slice 9 (guardrails — the live `num_ctx` return-cap pattern we mirror), Slice 10 (workflow engine — auto-write hook), Slice 11 (crews — the primary reader).
**Feeds:** Slice 13 (grounded verification — a verifier/critic is just another crew member/task that consumes citation-tagged recall).

---

## 1. Problem & goal

Every store we have today is ephemeral or flat: `runs/` (JSONL journals), `model-images/catalog.json`. Agents and crews have **no semantic recall** — a crew can't remember what it produced last run, and there's no way to ground answers in a corpus of documents. This slice adds the **real persistent data layer**: an embedded vector store + a structured store + an embeddings path + a retrieval pipeline, wired into crews/workflows so they can **read** (recall) and **write** (persist) memory.

### Validated framing (mid-2026, re-checked at slice-time — see [[reference-rag-grounding-findings]])
- **Vector store = `@lancedb/lancedb@0.30.0`** — embedded/on-disk (a directory like `runs/`), native TS SDK, disk-based IVF-PQ ANN (indexes past RAM), built-in hybrid (vector + FTS) + `RRFReranker`. darwin-arm64 is first-class. **Hard rule: never bundle it** — keep external so Bun resolves the platform `.node` at runtime.
- **Structured store = `bun:sqlite`** (built-in) for the **space registry** + **document manifest** (content-hash dedupe/staleness) — the structured tier mirroring CrewAI's SQLite long-term layer.
- **Embeddings via Ollama** through the existing runtime port. Default embedder `qwen3-embedding:0.6b` (MTEB ~64.3, smallest top-tier, Matryoshka dims); `bge-m3` as the long/multilingual tier; `nomic`/`mxbai` as fallbacks. Endpoint `POST /api/embed`; AI SDK v6 `embed`/`embedMany` via `ollama-ai-provider-v2`.
- **Pipeline** = semantic chunking → hybrid (dense + BM25/FTS, RRF-fused) → **budget-fit** → top-k. Cross-encoder rerank has **no clean default-on path in Ollama+LanceDB-JS+Bun** (verified: Ollama has no rerank endpoint; LanceDB-JS ships only `RRFReranker`; the only real JS cross-encoder is transformers.js/ONNX, which carries a Bun native-binding risk). So rerank is a **seam + an outcome-gated spike** (§2.9).
- **Anti-hallucination** first-class *later* (Slice 13). Slice 12 lands only the **primitives**: citation-ready chunk IDs + abstention on no/low evidence.

### Locked decisions (from brainstorm)
1. **One shared substrate serves BOTH** auto **run-memory** (crews/workflows persist task outputs) and **document/knowledge-base RAG** (ingest files). Same embed→store→retrieve plumbing; only the write-trigger differs.
2. **Two-level isolation.** A **space** = a named, independently-persisted collection = its own LanceDB table + a sqlite metadata row. A **namespace** = a filter partition *within* a space (per-crew run-memory). A user returns to a project by space name.
3. **Embedder binds to the space (data); chat model binds to the run (compute) — orthogonal.** All writes/recalls into a space use the space's **recorded** embedder + dim; the global default only seeds *new* spaces. Dimension mismatch = hard `MemoryError`. Changing a space's embedder = an explicit `reindex` (re-embed all), never silent.
4. **Read = recall tool (primary) + opt-in auto-inject.** A `recall(query)` tool (an `asDelegateTool`) any member may call; plus an opt-in per-task/crew flag that auto-injects top-k via `onBeforeDelegate`.
5. **Write = auto-write, namespaced per crew, opt-out.** Crew/workflow task outputs auto-persist to `space=default, namespace=<crewId>` unless the crew/task opts out. Docs use an explicit `ingest` path with content-hash dedupe.
6. **Resource integration reuses existing machinery — no new allocator** (§4). Embedder/reranker load via `ensureReady` as **weights-only** models (`kvBytesPerToken: 0`), sharing live-budget co-residency + LRU. Retrieval injection budget = a **live fraction of the delegation's chosen `num_ctx`**, mirroring the Slice-9 `returnCapChars` pattern. Chunk cap = **live** from the embedder's `/api/show` max-input.
7. **v1 rerank default = RRF-only** (clean, built-in, zero-risk). Cross-encoder rerank = seam + a time-boxed transformers.js spike **in this slice**; flips ON-by-default **iff** the spike passes under Bun (§2.9).
8. **Entry = `bun run memory <ingest|recall|stats|reindex>` + a `MemoryStore` core API.** Wired into `crew.ts` + `flow.ts`.
9. **Telemetry-to-emit (mandated):** `memory.recall` / `memory.ingest` / `memory.embed` spans + `ATTR.MEMORY_*`, nesting under `agent.delegation`/`workflow.step`.
10. **Architecture-doc update (mandated):** add a "Memory/RAG" section + `src/memory/` module-map node/edges to `docs/architecture.md`; update README + ROADMAP + regenerate the Artifact (docs hard line).

---

## 2. Components (new dir `src/memory/`)

### 2.1 `src/memory/types.ts` (the typed model)
```ts
export enum MemoryKind { RunMemory = 'run', Document = 'document' }

/** A stored, embedded unit of text. id is stable + surfaced in recall for citation. */
export type MemoryRecord = {
  id: string;                 // stable chunk id, e.g. `${source}#${ordinal}`
  space: string;              // collection name (→ LanceDB table)
  namespace: string;          // partition within a space (e.g. crew id); '' = space-wide
  kind: MemoryKind;
  text: string;
  vector: number[];           // dim == space.embedDim
  source: string;             // file path / crew:task / free label
  createdAt: number;          // epoch ms (passed in; no Date.now() in engine core)
};

/** Space metadata (sqlite) — the authority for a space's embedder + dims. */
export type SpaceMeta = {
  name: string;
  embedModel: string;         // recorded at creation; recall/write ALWAYS use this
  embedDim: number;           // vector width of the LanceDB table
  chunkCapTokens: number;     // derived live from embedModel max-input at creation
  createdAt: number;
};

export type Chunk = { text: string; ordinal: number };

export type RetrievalResult = {
  id: string; text: string; source: string; score: number; namespace: string;
};

export type RecallOptions = {
  space?: string;             // default 'default'
  namespace?: string;         // filter; omit = whole space
  kind?: MemoryKind;
  topK?: number;              // CEILING (fallback AGENT_MEMORY_TOP_K=6); budget may return fewer
  numCtx?: number;            // caller ctx for injection-budget fit; default from ALS
  rerank?: boolean;           // default from AGENT_MEMORY_RERANK (off unless spike passes)
};

export type MemoryConfig = {
  path?: string;              // dir, default AGENT_MEMORY_PATH='memory'
  embedModel?: string;        // default AGENT_MEMORY_EMBED_MODEL='qwen3-embedding:0.6b'
};
```

### 2.2 `src/memory/embed.ts` (embeddings via the runtime port)
- **Extend `RuntimeControl`** (`src/runtime/runtime.ts`) with `embed(model: string, texts: string[]): Promise<number[][]>`. Implement in `ollama.ts` via AI SDK v6 `embedMany({ model: ollamaProvider.textEmbeddingModel(model), values })` (batching/retries free); `mlx-server.ts` stubs/throws `MemoryError('embeddings unsupported on MLX runtime')` for now.
- **Embedder loads through the Model Manager** as a weights-only model (§4). `embedText(model, text)` / `embedTexts(model, texts[])` wrappers ensure-ready then call `control.embed`, wrapped in `withMemoryEmbedSpan`.
- **`probeEmbedder(model): Promise<{ dim: number; maxInput: number }>`** — reuse the `/api/show` pattern (`getModelMaxContext`/`getModelKvArch`): parse `model_info['<arch>.embedding_length']` (dim) + `<arch>.context_length` (max input). Cached per model. Feeds space creation (dim + chunk cap).

### 2.3 `src/memory/chunk.ts` (live-capped semantic chunking)
`chunk(text, { capTokens, embed }): Promise<Chunk[]>` — semantic chunking: split into sentences, embed adjacent sentences, cut where cosine similarity drops below a threshold, greedily pack up to `capTokens` (≈ chars/4). `capTokens` is **derived live** from the space's embedder max-input (never hardcoded). Deterministic fixed-size-with-overlap fallback when `embed` is unavailable (used by unit tests + as a safety net).

### 2.4 `src/memory/lancedb-store.ts` (vector tier — table per space)
Thin adapter over `@lancedb/lancedb`: `connect(dir)`; `openOrCreateTable(space, dim)`; `upsert(space, records[])`; `hybridSearch(space, { queryVector, queryText, namespace?, kind?, limit })` = dense (`.nearestTo`) ∪ FTS (`.fullTextSearch`, requires an FTS index on `text`) fused via `RRFReranker` → candidates; `count(space)`; `dropTable(space)` (for reindex). **Never imported into any bundle step.** A native-load smoke test asserts the darwin-arm64 `.node` resolves under Bun.

### 2.5 `src/memory/sqlite-store.ts` (structured tier)
`bun:sqlite` at `memory/memory.db`: tables `spaces` (SpaceMeta — the embedder authority) and `documents` (source, content hash, chunk count, mtime — for ingest dedupe/staleness). API: `getSpace(name)` / `createSpace(meta)` / `listSpaces`; `seenDoc(source, hash)` / `recordDoc(...)`. Atomic, corruption-safe (mirrors `catalog-cache.ts`).

### 2.6 `src/memory/retrieve.ts` (the pipeline)
`retrieve(query, opts, deps): Promise<RetrievalResult[]>`:
1. resolve space → `SpaceMeta` (its embedder is authoritative);
2. embed query with the **space's** embedder; guard `vector.length === space.embedDim` else `throw MemoryError`;
3. `lancedb.hybridSearch` (dense ∪ BM25, RRF-fused) within the namespace/kind filter → candidate list (e.g. ≤ 4×topK);
4. **if `rerank`** → cross-encoder rerank via the seam (§2.9);
5. **budget-fit:** `budgetChars = retrievalBudgetChars(opts.numCtx ?? currentDelegationContext().numCtx)` (§4); return top-ranked results whose cumulative text fits `budgetChars`, capped at `topK`. `topK` is a ceiling, not the driver.

### 2.7 `src/memory/store.ts` (`MemoryStore` facade) + `define.ts`
- `defineMemory(config): MemoryConfig` — validate path/model; on first use resolve the default embedder + `probeEmbedder`. Throws new `MemoryError` (`src/core/errors.ts`, extends `FrameworkError`).
- `MemoryStore`: `remember(text, { space, namespace, kind, source, at })` (chunk→embed→upsert, creating the space + recording its embedder/dim/chunkCap on first write); `ingest(path, { space, namespace, at })` (read file(s) → dedupe by hash → chunk → embed → upsert; skip unchanged); `recall(query, opts)` → `retrieve`; `reindex(space, newEmbedModel)` (drop+rebuild table under a new embedder — explicit, logged); `stats()`; `close()`. Space's recorded embedder always wins over the global default.

### 2.8 `src/memory/recall-tool.ts` (read integration)
`makeRecallTool(store, { space, namespace }): Tool` — an `asDelegateTool`-style tool `recall` with zod input `{ query: string; topK?: number }`, returns results formatted with citation tags `[mem:<id>]` + source. Bound into crew members + the orchestrator when memory is enabled. Empty/low-score → returns an explicit "no supporting memory found" (the **abstention primitive**, feeding the existing gap path). Also `injectRecall(agent, store, ...)` for the opt-in `onBeforeDelegate` auto-inject (prepends budget-fit top-k to the task).

### 2.9 Cross-encoder rerank — seam + spike (this slice)
- **Seam:** `retrieve.ts` calls an optional `Reranker` (implements LanceDB's generic `rerankHybrid` shape). Default = none (RRF only).
- **Spike task (outcome-gated):** wire a transformers.js cross-encoder (`Xenova/bge-reranker-base`) behind the seam; smoke-test under Bun on Apple Silicon.
  - **Pass** → rerank flips **ON by default** (`AGENT_MEMORY_RERANK` default true), reranker managed as a weights-only model; a `.live`/spike test guards it.
  - **Fail** (onnxruntime-node breaks under Bun) → seam stays, default OFF, documented "enable via a `llama-server /v1/rerank` backend"; RRF still ships. **Either outcome is a green slice** — the spike result is recorded in the plan + arch doc, not a blocker.

**Rerank spike outcome: PASS** — `bun add @huggingface/transformers` (v4.2.0) installed cleanly under Bun 1.3.11 on Apple Silicon; its one native transitive dependency, `onnxruntime-node@1.24.3`, ships a prebuilt `darwin/arm64` N-API binding (no compilation needed), and its blocked postinstall was approved via `bun pm trust` (now recorded in `package.json` `trustedDependencies` for reproducible clones). `src/memory/reranker.ts` implements `makeCrossEncoderReranker(model = 'Xenova/bge-reranker-base')` by loading `AutoTokenizer` + `AutoModelForSequenceClassification` directly (the built-in `pipeline('text-classification', ...)` helper does *not* forward `text_pair`, so a manual tokenizer call with `{ text_pair }` — the same pattern transformers.js's own question-answering pipeline uses internally — was required) and sorting by the last logit column descending. The spike test (`AGENT_MEMORY_RERANK_SPIKE=1 bun test tests/memory/reranker.spike.test.ts`) passed on the first and every subsequent run (~56s cold with model download, ~1.3s warm on cache), correctly ranking "the capital of France is Paris" above "bananas are yellow" for the query "what is the capital of France". Rerank is now **default ON**: `defaultRerank()` in `src/memory/retrieve.ts` returns true unless `AGENT_MEMORY_RERANK=0`, `store.recall()` resolves that live default when `RecallOptions.rerank` is unset, and `makeRealStore()` in `src/cli/memory.ts` wires `makeCrossEncoderReranker()` as the default `reranker` dependency. transformers.js manages its own ONNX weights cache independently of the project's Ollama Model Manager — no `ensureReady`/budget integration was added for it in this task (a follow-up could size it as a weights-only resource per §4, but that's out of scope for the spike). The `llama-server /v1/rerank` HTTP-backend alternative remains available as a swap-in `Reranker` implementation (documented in a code comment in `reranker.ts`) for anyone who wants to avoid the native ONNX dependency entirely.

### 2.10 `src/telemetry/spans.ts` (extend — additive)
`ATTR` gains `MEMORY_SPACE`, `MEMORY_NAMESPACE`, `MEMORY_CANDIDATES`, `MEMORY_RETURNED`, `MEMORY_RERANKED`, `MEMORY_EMBED_MODEL`. New `withMemoryRecallSpan` / `withMemoryIngestSpan` / `withMemoryEmbedSpan`, nesting under `agent.delegation`/`workflow.step`. Transport/OTLP seam untouched.

### 2.11 `src/cli/memory.ts` (entry)
`bun run memory ingest <path> [--space s] [--ns n] [--embed model]` · `recall "<query>" [--space s] [--ns n] [--top k]` · `stats` · `reindex --space s --embed model`. Mirrors `flow.ts`/`crew.ts` lifecycle (construct store, telemetry, close in `finally`). `package.json`: `"memory": "bun run src/cli/memory.ts"`.

### 2.12 Wiring into crews/workflows
- `WorkflowDeps` / `CrewDeps` gain optional `memory?: MemoryStore`. When present: bind `recall` tool to members/orchestrator; **auto-write** each completed+validated task output to `space=default, namespace=<crewId|workflowId>` unless `persistMemory === false` on the crew/task. Opt-in auto-inject flag prepends recall via `onBeforeDelegate`.

---

## 3. Data flow
```
memory ingest <path>        → chunk (live cap) → embedMany → lancedb.upsert + sqlite manifest
crew/flow run (memory on)   → task completes → remember(output, ns=crewId)         [auto-write, opt-out]
member calls recall(query)  → withMemoryRecallSpan
                               → space embedder → embed query → hybrid (dense∪BM25, RRF)
                               → [rerank seam] → budget-fit (fraction of num_ctx) → top-k [mem:<id>]
  → nests under agent.delegation / workflow.step → `bun run runs <id>` shows memory.recall
```
Chat-model selection (per run), depth/return guardrails, KV sizing, and typed I/O are all inherited unchanged. The embedder is loaded co-resident by the Model Manager under the same live budget.

## 4. Resource integration (the crux) — no new allocator
- **Embedder & reranker are managed models.** Declared with `footprint.kvBytesPerToken: 0` (weights-only, no generation → no KV), loaded via `ensureReady`, sharing `liveBudgetBytes()` co-residency + LRU + best-effort pinning. Tiny (~0.6B) so they nearly always fit; evicted first under pressure, reloaded next recall. `ensureReady`/manager math is **unchanged**.
- **Retrieval injection budget = live fraction of the delegation's chosen `num_ctx`.** Mirror `returnCapChars`: new `retrievalBudgetChars(numCtx) = floor(AGENT_MEMORY_CTX_FRACTION × (numCtx || FALLBACK) × CHARS_PER_TOKEN)`, reading `currentDelegationContext().numCtx` (ALS) when not passed. Retrieval fits *inside* the already-sized KV envelope → auto-consistent with KV-quant; the Model Manager is not touched.
- **Chunk cap derived live** from the embedder `/api/show` max-input at space creation (recorded in `SpaceMeta.chunkCapTokens`). No hardcoded chunk size.
- **Embedder⊥chat-model:** the space's recorded embedder is loaded regardless of which chat model the selector picked this run; dimension guard prevents mismatch.

## 5. Error handling & guards
- `defineMemory`/space ops throw `MemoryError` on: bad config, dimension mismatch (query dim ≠ space dim), unknown space on recall, unsupported runtime for embeddings.
- **Space embedder is authoritative** — global `AGENT_MEMORY_EMBED_MODEL` applies only to *new* spaces; existing spaces ignore it. Switching = explicit `reindex`.
- `recall` never throws into the agent loop on empty results — returns the abstention message. Ingest dedupe skips unchanged files (hash match). Store degrades safe on a corrupt sqlite/LanceDB dir (treat as empty, log).

## 6. Testing (TDD)
- `tests/memory/chunk.test.ts` — deterministic fixed-size fallback; semantic split with a mock embed; respects `capTokens`.
- `tests/memory/retrieve.test.ts` — RRF candidate merge + budget-fit (mock store + mock embed): returns fewer than `topK` when budget is tight; dimension-mismatch → `MemoryError`.
- `tests/memory/sqlite-store.test.ts` — space create/get (embedder authority), doc hash dedupe, corruption-safe read (temp dir).
- `tests/memory/define.test.ts` — config validation; embedder-per-space recorded + reused; global default ignored for existing space.
- `tests/memory/recall-tool.test.ts` — tool formats `[mem:<id>]` citations; empty → abstention string.
- `tests/memory/resource.test.ts` — `retrievalBudgetChars` scales with `num_ctx` + honors `AGENT_MEMORY_CTX_FRACTION`; weights-only footprint declares `kvBytesPerToken: 0`.
- `tests/cli/memory.test.ts` — `ingest`→`recall` roundtrip over a temp `memory/` with `MockLanguageModelV3` + a fake embed; writes/read spans.
- `tests/integration/memory.live.test.ts` (skips if Ollama down / embedder not pulled) — real `qwen3-embedding:0.6b`: ingest a doc → recall a relevant chunk; a crew auto-write → recall roundtrip.
- `tests/memory/lancedb-smoke.test.ts` — LanceDB native `.node` loads under Bun (arm64) + create/add/search a 4-row table.
- Rerank spike test (§2.9) — transformers.js cross-encoder loads + reranks under Bun; **records pass/fail** (drives the default).
- Regression: crew + workflow suites still pass (memory is optional/injected).

## 7. Out of scope (later)
Grounded verification / faithfulness judge / citation *enforcement* / CRAG loop (Slice 13 — verifier is another member) · multimodal (image/audio) embeddings (Phase F — the space abstraction is ready, but no CLIP-style vectors now) · HyDE / query rewrite / multi-turn condensation · cross-run entity resolution · server/distributed mode · a visual memory browser.

## 8. Acceptance
- `bun run check` green (docs-check · typecheck · lint · test); live + spike tests skip cleanly when Ollama/model absent.
- `bun run memory ingest <path>` then `recall "<q>"` returns relevant `[mem:<id>]`-tagged chunks (live).
- A crew with memory on **auto-writes** task outputs and a later member **recalls** them (live).
- Embedder loads co-resident under the live budget as weights-only; recall injection stays within the delegation's `num_ctx` (verified by test); chunk cap + embedder are derived/recorded live (no hardcoding).
- Changing the chat model between runs does **not** affect recall correctness (embedder bound to space); dimension mismatch errors cleanly.
- v1 ships RRF-default; the rerank spike outcome is recorded and, if green, rerank is ON with a guarding test.
- `@lancedb/lancedb@0.30.0` added and **not bundled**; native load smoke test passes.
- `docs/architecture.md` gains a Memory/RAG section (passes `docs:check`); README + ROADMAP updated; Artifact regenerated.

---

### Standing notes (per repo CLAUDE.md)
- **Architecture-doc update:** new "Memory/RAG" section + `src/memory/` node/edges in `docs/architecture.md`; README status/slice-table row 12; ROADMAP memory/RAG marker → ✅ (Slice 12); regenerate the snapshot Artifact.
- **Telemetry to emit:** `memory.recall` / `memory.ingest` / `memory.embed` spans with `ATTR.MEMORY_*`, nesting under `agent.delegation`/`workflow.step`, rendered by `bun run runs`.
