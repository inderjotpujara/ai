# Architecture

This is the **living** technical reference for the framework — a visual map of
how the system is wired and how data flows through it. For the product overview
see the [README](../README.md); for the long-range plan see
[`docs/ROADMAP.md`](ROADMAP.md); for the formal per-slice designs see
[`docs/superpowers/specs`](superpowers/specs).

> **Keep this current (standing obligation).** Every slice updates this doc as
> part of its work — treat a stale `architecture.md` as a slice defect. Each spec
> carries an "architecture-doc update" note alongside its "telemetry to emit"
> note. This is the structural counterpart to the **run-viewer** (which shows a
> single run at runtime); this shows how the whole system is wired.

---

## 1. Principles

- **Local-first, no API keys.** Models run locally (Ollama by default). Cloud is an opt-in backup only.
- **Autonomous & hardware-aware.** The system chooses a model, loads/unloads, sizes context, and records runs itself — budgeted to *live* RAM, never a frozen number.
- **Model freshness is runtime behavior, not a code change.** Agents declare a capability *requirement*; a selector resolves it against a registry that discovery refreshes per-machine. No model list is hardcoded in inference logic.
- **Compute live, env vars fallback-only.** RAM budget, `num_ctx`, KV sizing, and the delegated-return cap are all derived from live measurements; `AGENT_*` env vars are overrides/fallbacks, not the source of truth.
- **Observable by default.** Every subsystem that does meaningful work emits OpenTelemetry spans/events through `src/telemetry/spans.ts` (§7). The run-viewer and any OSS backend get new signal for free.
- **Safe composition.** Delegation is bounded by a depth limit (termination guarantee) and a live per-return size cap (§8), so deep multi-agent graphs can't compound cost/loops.
- **Small, modular, plain code; ports & adapters.** One responsibility per file; runtime (Ollama/MLX) and tool source (MCP) sit behind interfaces.

---

## 2. System map (modules & dependencies)

The engine is **Vercel AI SDK 6** (runtime-agnostic `LanguageModel`, the
tool-calling loop, MCP client, mock model, and `experimental_telemetry`). We
write only the thin layers on top.

```mermaid
graph TD
    subgraph CLI["CLI · src/cli"]
        chat["chat.ts (entry)"]
        runchat["run-chat.ts"]
        selhook["select-hook.ts"]
        selrt["select-runtime.ts · createSelectionRuntime"]
        runscli["runs.ts · bun run runs"]
        flow["flow.ts · bun run flow"]
        crewcli["crew.ts · bun run crew"]
        provcli["provision.ts · bun run provision"]
    end
    subgraph CORE["Core · src/core"]
        orch["orchestrator.ts"]
        delegate["delegate.ts"]
        agent["agent.ts · runAgent loop"]
        guard["guardrails.ts · ALS depth+budget"]
        types["types.ts · 4-axis taxonomy"]
    end
    subgraph RES["Resource · src/resource"]
        mgr["model-manager.ts"]
        sel["selector.ts"]
        hw["hardware.ts · live budget"]
        kv["kv-cache.ts"]
        octl["ollama-control.ts"]
    end
    subgraph RT["Runtime · src/runtime"]
        reg["registry.ts · runtimeFor"]
        ortime["ollama.ts"]
        mlx["mlx-server.ts"]
    end
    subgraph DISC["Discovery · src/discovery"]
        discover["discover.ts"]
        buildreg["build-registry.ts"]
        hfsrc["hf-gguf / hf-mlx"]
    end
    subgraph MCP["MCP · src/mcp"]
        mcpclient["client.ts · mountMcpServer"]
        mcpconfig["config.ts · loadMcpConfig"]
        mcpmount["mount.ts · mountAll"]
        mcppack["pack.ts · STARTER_PACK"]
    end
    subgraph TEL["Telemetry · src/telemetry"]
        spans["spans.ts · ATTR + helpers"]
        provider["provider.ts · OTel provider"]
        exporter["jsonl-exporter.ts"]
    end
    subgraph RUN["Run store · src/run"]
        runstore["run-store.ts"]
        runtrace["run-trace.ts"]
    end
    subgraph WF["Workflow · src/workflow"]
        wftypes["types.ts · StepKind"]
        wfdefine["define.ts · defineWorkflow"]
        wfengine["engine.ts · runWorkflow"]
        wfrunstep["run-step.ts · runStepByKind"]
    end
    subgraph CREW["Crew · src/crew"]
        crewtypes["types.ts · CrewMember/Task/CrewProcess"]
        crewdefine["define.ts · defineCrew"]
        crewmember["member-agent.ts · buildCrewAgent"]
        crewcompile["compile.ts · compileToWorkflow/buildHierarchicalOrchestrator"]
        crewengine["engine.ts · runCrew"]
    end
    subgraph MEM["Memory · src/memory"]
        memtypes["types.ts · MemoryRecord/SpaceMeta"]
        membudget["budget.ts · retrievalBudgetChars"]
        memembed["embed.ts · makeEmbedder"]
        memchunk["chunk.ts · semantic+fixed"]
        memsql["sqlite-store.ts · spaces+documents"]
        memlance["lancedb-store.ts · table-per-space"]
        memretrieve["retrieve.ts · dense→rerank→budget-fit"]
        memstore["store.ts · createMemoryStore"]
        memtool["recall-tool.ts · makeRecallTool"]
        memrerank["reranker.ts · cross-encoder"]
    end
    subgraph MEMCLI["CLI · src/cli/memory.ts"]
        memcli["bun run memory ingest/recall/stats/reindex"]
    end
    subgraph VERIFY["Verification · src/verification"]
        verifyconf["config.ts · verifyModel/Threshold/MaxRetries/autoPullPolicy"]
        verifytypes["types.ts · VerifyDeps/Verdict/Claim"]
        verifyclaims["claims.ts · decomposeClaims/parseCitations"]
        verifyjudge["judge.ts · checkClaim/verifyFaithfulness"]
        verifycrag["crag.ts · gradeRetrieval/correctiveRetrieve"]
        verifyprim["verify.ts · verify()"]
        verifyexpand["expand.ts · expandVerification/StepKind.Verify"]
        verifydeps["deps.ts · makeVerifyDeps"]
    end
    subgraph PROV["Provisioning · src/provisioning"]
        provisioner["provisioner.ts · runProvision"]
        provfit["fit.ts · fitAndRank"]
        provreg["registry.ts · providerFor/catalogSourcesFor/enrichSize"]
        provsup["supervisor.ts · checkDiskSpace/withRetry/StallWatchdog"]
        provollama["providers/ollama.ts · live-verified"]
        provhf["providers/hf-fetch.ts · GGUF+MLX, disk-write deferred"]
        provlmstudio["providers/lmstudio.ts · not yet wired into providerFor"]
        provcatollama["catalog/ollama-catalog.ts"]
        provcathf["catalog/hf-catalog.ts"]
        provcatsnap["catalog/snapshot-source.ts · degrade-never-crash"]
        provtypes["types.ts · DownloadPhase/DownloadProgress/DownloadProvider"]
        provtracker["progress-tracker.ts · ProgressTracker (monotonic % + EWMA speed)"]
        provformat["ui/format.ts · formatBytes/formatSpeed/formatEta/renderProgressLine"]
        provbar["ui/progress-bar.ts · ProgressBar (TTY vs non-TTY render)"]
        provprompt["ui/prompt.ts · askYesNo/selectModels (testable stdin)"]
    end
    subgraph DATA["On-disk · git-ignored"]
        spansfile[("runs/&lt;id&gt;/ spans.jsonl + .txt")]
        images[("model-images/ + catalog.json")]
    end
    subgraph DECL["Declarations (pure data)"]
        agents["agents/*"]
        models["models/* · BOOTSTRAP"]
        workflows["workflows/* · WORKFLOWS"]
        crews["crews/* · CREWS"]
        mcpjson["mcp.json · registry"]
    end

    chat --> runchat
    chat --> selhook
    chat --> buildreg
    chat --> agents
    chat --> mcpconfig
    chat -. mounts .-> mcpmount
    mcpconfig --> mcpjson
    mcpmount --> mcpclient
    runchat --> orch
    runchat --> provider
    orch --> delegate
    delegate --> guard
    delegate --> agent
    delegate --> spans
    agent --> spans
    selhook --> sel
    sel --> mgr
    mgr --> reg
    mgr --> hw
    mgr --> kv
    mgr --> spans
    reg --> ortime
    reg --> mlx
    ortime --> octl
    buildreg --> reg
    buildreg --> models
    discover --> hfsrc
    discover --> reg
    discover --> images
    agents -. hold tools .-> mcpclient
    spans --> provider
    provider --> exporter
    exporter --> spansfile
    octl --> images
    runscli --> runtrace
    runtrace --> spansfile
    flow --> wfengine
    flow --> runstore
    flow --> mcpconfig
    flow -. mounts .-> mcpmount
    flow --> agents
    flow --> workflows
    flow --> selrt
    wfengine --> wfrunstep
    wfrunstep --> delegate
    wfengine --> spans
    wfrunstep --> spans
    wfdefine --> wftypes
    crewengine --> crewcompile
    crewcompile --> crewmember
    crewcompile --> wfdefine
    crewmember --> sel
    crewengine --> wfengine
    crewengine --> orch
    crewengine --> spans
    crewdefine --> crewtypes
    crewtypes --> wftypes
    crewcli --> crewengine
    crewcli --> runstore
    crewcli --> mcpconfig
    crewcli -. mounts .-> mcpmount
    crewcli --> crews
    crewcli --> selrt
    selrt --> selhook
    selrt --> buildreg
    selrt --> mgr
    runstore --> spansfile
    crewengine --> memtool
    wfrunstep --> memstore
    memtool --> memstore
    memstore --> memretrieve
    memstore --> memsql
    memstore --> memlance
    memretrieve --> memlance
    memretrieve --> memrerank
    memretrieve --> membudget
    memembed --> mgr
    memembed --> spans
    memstore --> memchunk
    memcli --> memstore
    memcli --> memembed
    memcli --> memrerank
    memcli --> mgr
    wfengine --> verifyexpand
    crewcompile --> verifyexpand
    verifyexpand --> verifyprim
    verifyexpand --> verifycrag
    verifyexpand --> spans
    verifyprim --> verifyclaims
    verifyprim --> verifyjudge
    verifyprim --> spans
    verifyprim --> memstore
    verifydeps --> mgr
    verifydeps --> memstore
    crewcli --> verifydeps
    flow --> verifydeps
    provcli --> provisioner
    chat -. optional auto-detect .-> provisioner
    provisioner --> provfit
    provisioner --> provreg
    provisioner --> provsup
    provisioner --> spans
    provfit --> hw
    provreg --> provollama
    provreg --> provhf
    provreg --> provcatollama
    provreg --> provcathf
    provreg --> provcatsnap
    provcatollama --> provcatsnap
    provcathf --> provcatsnap
```

| Layer | Files | Responsibility | Knows about |
|---|---|---|---|
| **CLI** | `src/cli/` | Entry + orchestration of one run; `runs` viewer; deterministic-workflow entry (`flow.ts`); crew entry (`crew.ts`); memory entry (`memory.ts`, `bun run memory ingest\|recall\|stats\|reindex`); shared live-selection runtime builder (`select-runtime.ts`, extracted from `chat.ts`'s inline wiring, reused by `flow.ts` + `crew.ts`); per-run CLI scope helper (`with-mcp-run.ts`, Slice 16) — `withMcpRun(opts, body)` owns `createRun` → `initRunTelemetry` → `withMcpMountSpan(mountAll(...))` → `body` → `finally{reg.close(); tel.shutdown()}` for all three run CLIs, so `mcp.mount` lands in the run's `spans.jsonl` (§14) | everything below |
| **Core** | `src/core/` | Agent loop (`agent.ts`), orchestrator (agents-as-tools), `delegate.ts`, **`guardrails.ts`** (depth + return cap), taxonomy (`types.ts`), errors | AI SDK + telemetry |
| **Resource** | `src/resource/` | Live RAM budget, footprint, dynamic `num_ctx`, KV sizing/risk, warm/unload, selector | Ollama HTTP + `os` |
| **Runtime** | `src/runtime/` | Runtime port + Ollama-GGUF & MLX-server adapters; `createModel` per declaration | AI SDK + provider HTTP |
| **Providers** | `src/providers/` | Builds a concrete AI SDK `LanguageModel` from a declaration (the Ollama provider binding, `createOllamaModel`) used by the runtime adapters | AI SDK + Ollama provider |
| **Discovery** | `src/discovery/` | Host detector, HF catalog sources, offline `buildRegistry`, `runDiscovery` | Hugging Face HTTP + `os` |
| **Telemetry** | `src/telemetry/` | OTel provider, span helpers (`ATTR` + `withXSpan`/`recordX`), JSONL exporter — the **extensible** observability layer | OpenTelemetry SDK |
| **Tools / MCP** | `src/tools/`, `src/mcp/` | Define tools; declarative `mcp.json` registry + per-entry degrade (`config.ts`), consent-gated mounting with spec-hash/tools-hash pinning (`consent.ts`, `mount.ts`), curated 12-entry starter pack (`pack.ts`, Slice 15); mount/consume MCP servers (`client.ts`, `server.ts`, `sqlite-server.ts`) | MCP SDK + AI SDK MCP client |
| **Run store** | `src/run/` | Per-run dir + artifacts (`run-store.ts`); span reader/tree (`run-trace.ts`) | filesystem |
| **Declarations** | `models/`, `agents/`, `workflows/`, `crews/` | Data: which model / which agent / which workflow DAG / which crew (`crews/index.ts` `CREWS` + `getCrew`, mirrors `workflows/index.ts`; `research-crew.ts` is the reference sequential example) | nothing (pure data) |
| **Workflow / DAG** | `src/workflow/` | Deterministic multi-step engine (Slice 10): step types + `StepKind` (`types.ts`), construction-time DAG validation (`define.ts`), topological execution with bounded concurrency (`engine.ts`), per-kind step dispatch (`run-step.ts`) | `core/delegate.ts` (`runGuardedAgent`) + `telemetry/spans.ts` + Zod (I/O schemas) |
| **Crew / Roles** | `src/crew/`, `src/cli/crew.ts`, `crews/` | Team-of-agents orchestration layer (Slice 11): typed crew model + task graph (`types.ts`), crew-definition validation (`define.ts`), member → `Agent` construction (`member-agent.ts`), compile to a `WorkflowDef` (sequential) or an orchestrator `Agent` (hierarchical) (`compile.ts`), `runCrew` dispatcher under a `crew.run` span (`engine.ts`); CLI entry `runCrewCli`/`main()` (`src/cli/crew.ts`, `bun run crew <name> [input...]`) mirrors `runFlow`/`flow.ts` — both `main()`s now run their whole scope inside `withMcpRun` (`with-mcp-run.ts`, Slice 16, §14), which owns `createRun` → `initRunTelemetry` → mount before handing the run body a `run: RunHandle`: `runCrewCli` → `writeArtifact('result.txt'\|'failed.txt')`, with `shutdown()` happening in `withMcpRun`'s `finally`; both `crew.ts` and `flow.ts` build live model selection via `createSelectionRuntime()` (`select-runtime.ts`) and pass `onBeforeDelegate` into their agent steps | `workflow/engine.ts` (sequential) + `core/orchestrator.ts` + `core/delegate.ts` (hierarchical + live model selection via `onBeforeDelegate`) + `resource/selector.ts` (indirectly, via the same hook) + `cli/select-runtime.ts` |
| **Memory / RAG** | `src/memory/`, `src/cli/memory.ts` | Persistent semantic memory (Slice 12): two-tier store — LanceDB table-per-space (`lancedb-store.ts`) + `bun:sqlite` space registry/document manifest (`sqlite-store.ts`) — space-scoped embedder-authority (`types.ts`), weights-only embedding via the Model Manager (`embed.ts`), semantic/fixed chunking (`chunk.ts`), dense→optional-rerank→budget-fit retrieval (`retrieve.ts`, `reranker.ts`), the `createMemoryStore` facade (`store.ts`) and `recall` tool (`recall-tool.ts`); CLI `bun run memory ingest\|recall\|stats\|reindex` (`src/cli/memory.ts`); optional `memory` dep on `runCrew`/`runWorkflow` binds a `recall` tool + auto-persists task/step output | `resource/model-manager.ts` (`ensureReady`) + `runtime` (`RuntimeControl.embed`) + `telemetry/spans.ts` + `core/guardrails.ts` (injection budget off the live `numCtx`) |
| **Verification** | `src/verification/` | Anti-hallucination layer (Slice 13): grounded verification of agent outputs against the memory chunks they cite — claim decomposition (`claims.ts`), a MiniCheck-style per-claim faithfulness judge with consent-pull + general-model fallback (`judge.ts`, `deps.ts`), bounded Corrective RAG (`crag.ts`), the `verify()` primitive (`verify.ts`), and the opt-in verify→branch→corrective→abstain sub-graph expander (`expand.ts`, `StepKind.Verify`) spliced into workflows/crews via `--verify` (§12) | `memory/store.ts` (`getByIds`) + `resource/model-manager.ts` (`ensureReady`) + `runtime` (consent-pull) + `telemetry/spans.ts` |
| **Provisioning** | `src/provisioning/` | First-boot / on-demand model provisioning (Slice 14 — shipped): `runProvision` (`provisioner.ts`) orchestrates detect-host → two-phase catalog discovery with committed-snapshot fallback (`catalog/`, `registry.ts`) → hardware-fit ranking (`fit.ts`, `fitAndRank`) → per-model consent → disk preflight + stall/retry supervisor guards (`supervisor.ts`) → sequential downloads through a runtime-agnostic `DownloadProvider` abstraction (`types.ts`) with a unified progress protocol; three adapters (`providers/`) — **Ollama live-verified end-to-end**, **HF-fetch (llama.cpp GGUF + MLX) and LM Studio contract-tested only, live-verify deferred** (HF-fetch does not yet persist bytes to disk); dependency-free UI (`ui/`); CLI entry `bun run provision` plus a non-invasive TTY-gated auto-detect hook in `chat.ts`; telemetry via `withProvisionSpan` (§13) | `core/types.ts` (`ProviderKind`), `resource/footprint.ts` + `resource/hardware.ts` (fit math), `resource/ollama-control.ts` (install confirm), `discovery/catalog-source.ts` (shared discovery types), `telemetry/spans.ts` — no other subsystem depends on provisioning yet |

**Key decoupling:** `core/agent.ts` takes a generic `ToolSet` — it doesn't know tools come from MCP. Same agent code is unit-tested with an in-process tool + mock model, and run for real with MCP-sourced tools.

---

## 3. Runtime data flow (one `chat` run, current)

```mermaid
sequenceDiagram
    actor User
    participant CLI as cli/chat.ts
    participant RunChat as cli/run-chat.ts
    participant Tel as telemetry (spans→spans.jsonl)
    participant Orch as core/orchestrator.ts
    participant Guard as core/guardrails.ts
    participant Hook as cli/select-hook.ts
    participant Mgr as resource/model-manager.ts
    participant Ollama

    User->>CLI: task (argv)
    CLI->>CLI: buildRegistry() (offline merge)
    CLI->>Tel: withMcpRun: createRun → initRunTelemetry(runDir) — OTel provider → spans.jsonl
    CLI->>CLI: withMcpRun: loadMcpConfig() → consent gate → mountAll() (mcp.mount span, now inside the run's tracer — Slice 16)
    CLI->>RunChat: runChat({orchestrator, task, run})
    RunChat->>Guard: withRootDelegationContext(routerNumCtx)
    RunChat->>Tel: withRunSpan("agent.run")
    RunChat->>Orch: runOrchestrator(orchestrator, task)
    Orch->>Ollama: router generateText (experimental_telemetry → ai.* spans)
    Ollama-->>Orch: tool-call delegate_to_<specialist>
    Orch->>Guard: checkDelegation(target) — depth+1 > 5? → soft {error}+event
    Orch->>Tel: withDelegationSpan (tags depth, ancestors)
    Orch->>Guard: runInDelegationContext(target, numCtx)
    Orch->>Hook: onBeforeDelegate(agent)
    Hook->>Mgr: resolveModel → ensureReady(decl)
    Mgr->>Ollama: live budget → evict LRU → warm(chosenCtx) — model.load/evict spans
    Hook-->>Orch: bound model + numCtx (recordModelSelect)
    Orch->>Ollama: specialist generateText (ai.* + token spans)
    Ollama-->>Orch: answer text
    Orch->>Guard: concise(text, callerNumCtx) — cap = ¼ × caller num_ctx × 4 chars
    Orch-->>RunChat: OrchestratorResult {answer | gap | resource}
    RunChat->>Tel: setRunOutcome + shutdown (flush spans.jsonl)
    RunChat->>RunChat: writeArtifact(answer/gap/resource.txt)
    CLI-->>User: print answer
    Note over User,Ollama: `bun run runs <id>` renders spans.jsonl as a timeline
```

A delegation that would exceed depth 5 returns a **soft** `{error}` the orchestrator can adapt to (not a crash); recursion (a repeated agent name) is allowed — depth is the bound. Every step above is captured as a nested OTel span.

### 3a. Provisioning flow (first-boot / `bun run provision`, Slice 14)

Provisioning is a **separate, optional pre-flow** — it is not part of every
`chat` run above. It runs either as its own CLI entry point or via an
optional, TTY-gated auto-detect hook inside `chat.ts`; it is never invoked
inline on a normal chat turn.

```mermaid
sequenceDiagram
    actor User
    participant CLI as cli/provision.ts
    participant Prov as provisioning/provisioner.ts
    participant Cat as CatalogSource(s)
    participant Fit as fit.ts
    participant UI as ui/prompt.ts
    participant Sup as supervisor.ts
    participant DP as DownloadProvider(s)

    User->>CLI: bun run provision
    CLI->>Prov: runProvision({deps})
    Prov->>Prov: detectHost()
    Prov->>Cat: listCandidates(query) per applicable source
    Note over Cat: withSnapshotFallback — a source throw or<br/>empty list degrades to the committed snapshot.json
    Cat-->>Prov: Candidate[]
    Prov->>Fit: fitAndRank(candidates, liveBudgetBytes)
    Fit-->>Prov: FitCandidate[] (recommended pre-marked)
    Prov->>UI: selectModels(ranked) — per-model consent
    UI-->>Prov: selected[]
    Prov->>Sup: checkDiskSpace(required, free)
    Sup-->>Prov: ok | shortfall (prompts "continue anyway?")
    loop each selected model, sequential
        Prov->>DP: download(modelRef, {onProgress, signal})
        DP-->>Prov: progress events → live bar; Done or throw (caught → result.failed)
    end
    Prov-->>CLI: ProvisionResult {downloaded, declined, failed}
    CLI-->>User: "Provisioned: N · declined: N · failed: N"
    Note over User,DP: chat.ts has an optional, TTY+consent-gated auto-detect<br/>hook (maybeAutoProvision) that calls this same runProvision path<br/>when a declared model is missing — never invoked inline mid-turn.
```

---

## 4. Resource model (Apple Silicon)

Live budgeting + dynamic context sizing (Slices 4–5, 7).

**Live budget (`liveBudgetBytes`, `src/resource/hardware.ts`):** `min(0.75 × total RAM, 0.8 × live free RAM)` (the first term is the Metal cap, `machineBudgetBytes()`), recomputed every delegation. Live free RAM = `availableRamBytes()` parsing `vm_stat` (`free + inactive + speculative + purgeable`); falls back to `os.freemem()` → half total. Fractions overridable via `AGENT_GPU_BUDGET_FRACTION` / `AGENT_FREE_BUDGET_FRACTION` (fallback-only).

**Footprint (`src/resource/footprint.ts`):** `weightsBytes(paramsB, bytesPerWeight)` = `paramsB × 1e9 × bytesPerWeight × 1.2` (1.2 = `RUNTIME_OVERHEAD`); `kvCacheBytes(tokens, kvBytesPerToken)`.

**Dynamic `num_ctx` (`src/resource/model-manager.ts`):** `chosenCtx = min(desired, modelMax, maxCtxByFit)`, floor `MIN_CTX=4096`, rounded to `CTX_ROUNDING=1024`. `modelMax` probed live via `POST /api/show` (`model_info["<arch>.context_length"]`); `maxCtxByFit = floor((headroom − weights) / kvPerToken)`. The same `chosenCtx` is used for warm AND inference (no runner reload).

**Manager state** (all keyed by the **model string**, so two agents sharing a model share one resident copy): `lastUsed` (LRU), `chosenCtxByModel`, `maxCtxByModel`, `runtimeByModel`, `kvF16ByModel`, `kvRiskWarned`. `ensureReady` = check installed/loaded → compute min footprint → evict LRU non-pinned (then pinned, best-effort, as last resort) → size ctx → `withModelLoadSpan(c.warm)`. Control via Ollama HTTP (`ollama-control.ts`): warm/unload = `POST /api/generate`, list = `GET /api/ps`, probes = `POST /api/show`.

### KV-cache quantization (Slice 7)
Global type via `AGENT_KV_CACHE_TYPE` (default `q8_0`) + `OLLAMA_FLASH_ATTENTION=1`, both set by `scripts/serve.sh`. Per-model f16 baseline from `/api/show` arch: `f16KvBytesPerToken = block_count × head_count_kv × (key_length + value_length) × 2`; `effectiveKvBytesPerToken` × type multiplier (`f16`→1.0, `q8_0`→0.5, `q4_0`→0.25). Arch-derived risk advisory: `key_length ≤ 64` (small head_dim) **or** `expert_count > 0` (MoE) — no model-family names anywhere.

### Dynamic model selection (Slice 5)
`selectCandidates` (pure: capability hard-filter → largest-that-fits → warm-aware tie-break) → `resolveModel` (live fallback loop against `ensureReady`, the single fit-authority; `ResourceError` → next candidate). Bound lazily at delegation via `onBeforeDelegate` (`src/cli/select-hook.ts`) which also prints the one-line selection notice. A genuine no-fit → `ResourceCapture` seam → `runOrchestrator` returns `{kind:'resource'}` → non-zero exit (never a hallucinated answer).

---

## 5. Discovery & runtimes (Slice 6)

**Runtime port** (`src/runtime/runtime.ts`): `RuntimeControl` (`isInstalled`/`pull`/`warm`/`unload`/`listLoaded`/`getModelMax`/`getModelKvArch`) + `Runtime` (`kind`/`isAvailable`/`createModel`/`control`). Adapters: **Ollama** (`ollama.ts`, Tier-1) and **MLX server** (`mlx-server.ts`, OpenAI-compatible at `MLX_BASE_URL` default `:1234/v1`; server owns lifecycle). `registry.ts`: `runtimeFor(kind)` / `availableRuntimes()`.

**Catalog sources** (`CatalogSource`): `hf-gguf` + `hf-mlx` (trusted publishers, tool-capability via `chat_template`, best-fitting quant via `quant.ts`). `detectHost()` probes live budget + available runtimes; `appliesTo(host)` gates each source.

**`runDiscovery`** (`discover.ts`): detect host → list candidates per source (skip failures) → dedupe by `(provider, repo)` → rank (downloads, then params) → write `model-images/catalog.json` (atomic) → pre-pull top-1.

**`buildRegistry`** (`build-registry.ts`, offline-safe): merge **bootstrap** (`models/registry.ts` `BOOTSTRAP`) ∪ **installed** (live `listLoaded`) ∪ **cached catalog** (filtered to installed-only). This is the registry `resolveModel` uses at chat time — no network on the chat path.

### Four axes (`src/core/types.ts`)
| Axis | Values | Enum |
|---|---|---|
| Capability / modality | Tools, Vision, Audio, Video | `Capability` |
| Runtime | Ollama, MlxServer | `ProviderKind` |
| Content policy | Default, Uncensored *(seam)* | `ContentPolicy` |
| Source | hf-gguf, hf-mlx | `CatalogSource.name` |

---

## 6. Why Ollama

We use **llama.cpp through Ollama** — it wraps the engine (and Apple MLX on 32 GB+ Macs) and adds model management (`pull`/`ps`, auto-quant), an HTTP control API the resource manager drives, tool-calling, and a clean AI SDK provider. Because the model layer is runtime-agnostic, Ollama is just the default **Tier-1 adapter**; a raw `llama.cpp-server` or dedicated MLX-server can slot behind the same `Runtime` interface with no agent code change.

---

## 7. Observability — telemetry & run-viewer (Slice 8)

Each run is an **OpenTelemetry trace** written to `runs/<id>/spans.jsonl`, viewable with a terminal run-viewer. This is the **extensible layer every later feature emits into** (the "observable by default" principle).

- **`provider.ts`** — `initRunTelemetry(runDir)` registers a per-run, Bun-safe `BasicTracerProvider` + `AsyncLocalStorageContextManager` (no Node auto-instrumentation), and processors via `buildProcessors`: a `JsonlFileExporter` always, **plus** an OTLP/HTTP exporter when `AGENT_OTLP_ENDPOINT` is set (the swappable-backend seam → Jaeger/Tempo/Phoenix). `recordIoEnabled()` gates prompt/response capture (`AGENT_TELEMETRY_RECORD_IO`).
- **`jsonl-exporter.ts`** — a `SpanExporter` serializing each span to one JSON line (`SpanRecord`); writes are serialized through a promise chain and **flushed on `shutdown()`** so `spans.jsonl` is never truncated.
- **`spans.ts`** — the API: the **`ATTR`** key registry + helpers `withRunSpan` / `setRunOutcome` / `withDelegationSpan` / `recordModelSelect` / `withModelLoadSpan` / `recordEvict` / `recordGuardrailViolation` / `withWorkflowSpan` / `withStepSpan` / `annotateStep` (the last three back the workflow/DAG engine, §9). **AI-SDK** `experimental_telemetry` (enabled per `generateText` with `functionId = agent.name`) contributes `ai.generateText` / `ai.toolCall` / token spans for free, nested under our manual spans via the active context.

**Run-viewer** (`bun run runs`, `src/cli/runs.ts`): `runs` lists runs (newest-first); `runs <id>` renders the span tree as an indented timeline (model · duration · tokens · outcome); `--follow` tails the live run. Reader/renderer are pure (`src/run/run-trace.ts` `readSpans`/`buildTree`/`summarizeRun`; `src/cli/render-trace.ts`). `journal.jsonl` is retired — `spans.jsonl` is canonical; `answer/gap/resource.txt` artifacts remain.

**Extending telemetry (standing rule):** a new subsystem adds a `withXSpan`/`recordX` helper + `ATTR` keys here — the transport (provider/exporter) and the OTLP seam are untouched, and both the local viewer and any backend get the new signal for free.

---

## 8. Composition guardrails (Slice 9)

The safe-composition foundation for the future workflow/crew engine. Each delegation is a fresh, isolated `generateText` instance, so the risks are **non-termination** and **cost**, not state corruption — both bounded by depth. Backed by an `AsyncLocalStorage<DelegationContext>` (`{depth, ancestors, numCtx}`) in `src/core/guardrails.ts`, enforced at the single delegation chokepoint (`delegate.ts`).

- **Depth limit (the termination guarantee).** `checkDelegation` rejects when `current.depth + 1 > maxDelegationDepth()` (default 5, `AGENT_MAX_DELEGATION_DEPTH`). Every hop goes through `runInDelegationContext` (depth++), and the orchestrator root is seeded via `withRootDelegationContext` — so **no chain can bypass the counter**; any chain (incl. self-recursion) terminates ≤ depth levels. **Recursion is allowed** (no name-based cycle ban — that would forbid legitimate recursive decomposition); ancestry is carried for telemetry only.
- **Live return cap.** `concise(text, callerNumCtx)` caps a delegated return to `floor(returnCtxFraction() × callerNumCtx × 4 chars/token)` — a fraction (default 0.25, `AGENT_RETURN_CTX_FRACTION`) of the **consumer's** live `num_ctx`, captured from the parent frame before entering the child. Not a flat constant — it scales with the same hardware-aware budget as everything else.
- **Soft failure.** Violations return `{ error }` from the delegate tool (the existing soft-tool-error path) so the calling agent's LLM can adapt, plus an `agent.guardrail.violation` span event. `withDelegationSpan` tags `agent.delegation.depth` / `agent.delegation.ancestors` (visible in `bun run runs`).
- **Warm-model reuse** is already provided by the manager (state keyed by model string); locked in by a regression test.

---

## 9. Workflows / DAG engine (Slice 10)

**Pure types + execution model for deterministic multi-step workflows.** While the agent loop is *agentic* (an LLM autonomously chooses actions), workflows are *choreographed* — steps run in a defined DAG order, each produces validated output, and branches/maps are explicit.

- **Types** (`src/workflow/types.ts`): 
  - `enum StepKind { Agent, Tool, Branch, Map, Verify }` — the fifth kind,
    `Verify`, is the additive Slice-13 grounded-verification op (§12); a
    workflow that never opts in compiles and runs exactly as before.
  - `WorkflowContext` — thread of `{stepId: output}` through a run; maps + branches thread `item`/`index`
  - Step variants: `AgentStep` (run an agent, input is a prompt — carries an
    opt-in `verify?: boolean`, §12), `ToolStep` (call a tool, input is args),
    `BranchStep` (if-then-else on a predicate), `MapStep` (fan-out per item in
    a list, run sub-step once per item), `VerifyStep` (§12 — `op: 'verify' |
    'corrective' | 'pass' | 'abstain'`, only ever produced by
    `expandVerification`, never authored directly in a workflow definition)
  - `StepError` — per-step failure policy: `'fail'` (fast), `'continue'` (skip on error), `{ fallback }` (use a fallback value)
  - `WorkflowDef` — a named list of steps + metadata
  - `WorkflowOutcome` — `{ kind: 'done', output }`, `{ kind: 'failed', failedStep, message }`, or `{ kind: 'unverified', failedStepId, unsupportedClaims, faithfulness, draft }` (§12 — a verify-and-abstain terminal outcome)
  - `effectiveDeps(step, index, steps)` — helper: explicit `dependsOn` or implicit previous-step deps

- **Error class** (`src/core/errors.ts`): `WorkflowError extends FrameworkError` for workflow-specific failures (bad definition, step failure, context mismatch)

- **Telemetry** (`src/telemetry/spans.ts`) — extended per the standing rule (§7): `withWorkflowSpan(workflowId, fn)` opens the root `workflow.run` span (`ATTR.WORKFLOW_ID`); `withStepSpan(stepId, kind, fn)` opens a nested `workflow.step` span per step (`ATTR.STEP_ID` / `ATTR.STEP_KIND`); `annotateStep(attrs)` tags the active step span with extra attributes (`ATTR.STEP_BRANCH_TAKEN` for the branch taken, `ATTR.STEP_MAP_COUNT` for map fan-out size); `ATTR.WORKFLOW_OUTCOME` records the terminal `WorkflowOutcome`. These are the spans/attrs the execution engine (Task 6) and CLI (Task 7) emit into — transport untouched, so the run-viewer and any OTLP backend get workflow signal for free.

- **Step runner** (`src/workflow/run-step.ts`): `runStepByKind(step, ctx, deps)` dispatches a step to its kind (agent/tool/branch/map) and returns the *raw*, unvalidated result; `WorkflowDeps` (`runAgentStep`, `tools`, `maxParallel`) is the injected boundary the engine and CLI provide; `mapWithConcurrency` bounds fan-out concurrency for `MapStep` (default cap `DEFAULT_MAX_PARALLEL`, overridable via `AGENT_WORKFLOW_MAX_PARALLEL` or per-map `maxParallel`).

- **Execution engine** (`src/workflow/engine.ts`): `runWorkflow(def, input, deps)` seeds `ctx = { input }` and runs the DAG wave-by-wave — each wave collects every step whose `effectiveDeps` are `done` (bounded per-wave by `maxParallel`), runs them concurrently inside `withStepSpan`, and validates each raw result against the step's `output` zod schema. A step whose dependency was skipped is itself marked skipped (cascading dead-arm/`continue` propagation through descendants). On step error, the `onError` policy decides the outcome: `'fail'` (default) stops the run and returns `{kind:'failed', failedStep, message}`; `'continue'` marks the step skipped; `{fallback}` seeds `ctx[step.id]` with the fallback value and marks the step *done* (so downstream steps still see it as satisfied). After a `BranchStep` resolves, the non-taken target is added to `skipped`. The engine never throws to its caller — all step errors are caught and resolved through the policy above — and returns `{kind:'done', output: ctx}` once no further step is ready, or `{kind:'unverified', ...}` if the finished context carries a Slice-13 `UnverifiedMarker` (`findUnverified`, §12).

- **Definition + validation** (`src/workflow/define.ts`): `defineWorkflow(def)` validates a `WorkflowDef` at construction time — unique step ids, every `dependsOn`/branch target resolves to a real step, and the dependency graph is acyclic (Kahn's algorithm) — throwing `WorkflowError` on any violation, so a malformed workflow fails fast at import time rather than mid-run.

- **Registry** (`workflows/index.ts`, `workflows/fetch-then-summarize.ts`): `WORKFLOWS: Record<string, WorkflowDef>` + `getWorkflow(name)` — mirrors `models/registry.ts`. `fetch-then-summarize` is the reference example: a `tool` step (`fetch`, via `mcp-server-fetch`) feeding a `web_fetch` `agent` step that summarizes the fetched content.

- **CLI entry** (`src/cli/flow.ts`): `bun run flow <name> [input...]` — the workflow analog of `chat.ts`/`run-chat.ts`. `main()` resolves the workflow via `getWorkflow`, then calls `withMcpRun` (`src/cli/with-mcp-run.ts`, Slice 16; see §14), which owns `createRun` → `initRunTelemetry` → `loadMcpConfig()`+`mountAll()` (consent-gated per §14) in that order and hands the body a `run: RunHandle`. The body builds the `agents` map from `createFileQaAgent`/`createWebFetchAgent` keyed by `.name`, builds the shared live-selection runtime (below), and calls `runFlow(deps)` with that `run`. `runFlow(deps)` itself wraps `withWorkflowSpan(def.id, …)` around `runWorkflow` → on `done`, `annotateStep({[ATTR.WORKFLOW_OUTCOME]: outcome.kind})` then `writeArtifact('result.txt', <last step's output>)`; on `failed`, `writeArtifact('failed.txt', "step <id>: <message>")` — all still inside the `workflow.run` span so the outcome attribute lands on it. `main()` prints the last step's output (or the failure) to stdout/stderr, closing the selection runtime in `finally`; `withMcpRun`'s own `finally` closes the mounted registry and shuts down telemetry.

- **Shared live-selection runtime** (`src/cli/select-runtime.ts`, Slice 11 Task 7): `createSelectionRuntime(opts?)` extracts `chat.ts`'s inline manager + offline `buildRegistry()` + `createSelectHook` + one-line selection `notify` into a single reusable async factory, returning `{ onBeforeDelegate, capture, close }`. `close()` calls `manager.unloadAll()`. Both `flow.ts`'s and `crew.ts`'s `main()` build one runtime per CLI invocation (nested inside the mounted MCP registry, closed in `finally`) and thread `onBeforeDelegate` into `defaultRunAgentStep`/`runCrew` respectively — so a workflow agent step or a crew member is resolved to the largest model that fits the *live* RAM budget at delegation time, the same guarantee `chat.ts` gives its orchestrator. `chat.ts` itself is left with its original inline wiring in this slice; deduping it against `select-runtime.ts` is a follow-up.

---

## 10. Crews & roles (Slice 11)

A CrewAI-style **role/task/process** layer — a **thin composition** over the
workflow engine (§9, sequential) and the orchestrator (§17 Glossary,
hierarchical), **not a new engine**: both processes ultimately run on
machinery Slices 9/10 already shipped.

- **Types** (`src/crew/types.ts`): `CrewMember{name, role, goal, backstory,
  requires, prefer, tools?}` — `role`/`goal`/`backstory` are prompt scaffolding;
  `requires`/`prefer` are the same `Capability[]`/`PreferPolicy` axes the core
  selector already uses, so a member's model is a live selection, not a
  hardcoded one. `Task{id, description, expectedOutput, member, dependsOn?,
  output?}` — `description`+`expectedOutput` are prompt text, `member` is the
  `CrewMember.name` that runs it, `dependsOn` are upstream task ids whose
  outputs become context, `output` is an optional zod schema for typed
  hand-offs (defaults to `z.string()` when compiled). `enum CrewProcess {
  Sequential, Hierarchical }`. `CrewDef{id, description?, members, tasks,
  process, managerModel?}`. `CrewOutcome` — `{kind:'done', output}` or
  `{kind:'failed', failedTask?, message}`.
- **Validation** (`src/crew/define.ts`): `defineCrew(def)` checks at
  construction time — unique member names, unique task ids, every
  `task.member` resolves to a real member, every effective dependency
  (`effectiveTaskDeps`: explicit `dependsOn`, else the previous task, else `[]`
  for the first task — the CrewAI sequential default) resolves to a real task,
  and the task graph is acyclic (Kahn's algorithm, same technique as
  `workflow/define.ts`) — throwing `CrewError` on any violation.
- **Member → agent** (`src/crew/member-agent.ts`): `buildCrewAgent(member,
  tools?)` composes role/goal/backstory into an `Agent.systemPrompt`, sets
  `description` (routing) and `modelReq: {role, requires, prefer}`. The model
  bound at construction (`qwenFast`) is a placeholder — the real model is
  resolved **live** by the selector at delegation via `modelReq` +
  `onBeforeDelegate`, exactly like the preset agents (this is the only
  genuinely new mechanism the layer adds).
- **Compile** (`src/crew/compile.ts`): **sequential** — `compileToWorkflow`
  maps each task to an `AgentStep` (`agent = task.member`, `dependsOn` = the
  effective deps, `input` = `composeTaskInput` which renders the task's
  description/expected-output plus either the crew's raw input (root task) or
  its dependencies' outputs as context, `output = task.output ?? z.string()`),
  then runs `defineWorkflow` as a second validation gate and executes on the
  **existing** Slice-10 engine unmodified. **Hierarchical** —
  `buildHierarchicalOrchestrator` builds one `Agent` per member via
  `buildCrewAgent`, writes a manager system prompt listing every task
  (`member: description -> expectedOutput`), and hands the member agents +
  that prompt to `createOrchestrator` (model defaults to `qwenRouter`, or
  `crew.managerModel`) — the manager delegates autonomously rather than the
  crew enforcing task order (a documented v1 simplification; sequential is the
  deterministic path).
- **Engine** (`src/crew/engine.ts`): `runCrew(def, input, deps)` dispatches by
  `def.process` inside a `withCrewSpan` (`crew.run` root span). Sequential:
  builds a member-name → `Agent` map (`crewAgentMap`), resolves `runAgentStep`
  to `deps.runAgentStep` (test seam) or `defaultRunAgentStep(agents,
  onBeforeDelegate)`, and calls `runWorkflow` — since `runWorkflow` itself
  never throws (§9), **the sequential path never throws into the caller**.
  Hierarchical: builds the orchestrator and calls `runOrchestrator`, which
  *can* `throw` for an unhandled failure that is neither a captured resource
  error nor a `MaxStepsError` carrying a capability gap (§4/§8) — so **the
  hierarchical path inherits `runOrchestrator`'s throw-on-unhandled-failure
  behavior**; `runCrew` as a whole is not unconditionally throw-free. Both
  paths reuse `runGuardedAgent` (`core/delegate.ts`, Slice-9 guardrails: depth
  limit + live return cap) and the same live selector via `onBeforeDelegate`.
- **Telemetry** (`src/telemetry/spans.ts`): `withCrewSpan(crewId, process, fn)`
  opens the root `crew.run` span (`ATTR.CREW_ID`, `ATTR.CREW_PROCESS`);
  `ATTR.CREW_TASK_MEMBER` tags which member ran a given task. Nested beneath
  it: `workflow.run`/`workflow.step` spans (sequential, §9) or
  `agent.delegation` spans (hierarchical, §3/§8) — so `bun run runs` renders
  `crew.run → workflow.step → …` or `crew.run → agent.delegation → …`
  depending on `process`, with no crew-specific viewer changes needed.
- **CLI entry** (`src/cli/crew.ts`, mirrors `flow.ts`): `bun run crew <name>
  [input...]` over the `crews/` registry (`crews/index.ts` `CREWS` + `getCrew`,
  mirrors `workflows/index.ts`; `research-crew.ts` is the reference sequential
  example). `main()` resolves the crew via `getCrew`, then calls `withMcpRun`
  (`src/cli/with-mcp-run.ts`, Slice 16; see §14), which owns `createRun` →
  `initRunTelemetry` → `loadMcpConfig()`+`mountAll()` (consent-gated per §14)
  in that order and hands the body a `run: RunHandle`. The body builds a
  `createSelectionRuntime()` (§9, shared with `flow.ts`) and calls
  `runCrewCli(deps)` with that `run` and `onBeforeDelegate`. `runCrewCli(deps)`
  itself calls `runCrew(def, input, {tools, onBeforeDelegate, runAgentStep})`
  → on `done`, `writeArtifact('result.txt', <output as text or pretty JSON>)`;
  on `failed`, `writeArtifact('failed.txt', "task <id>: <message>")`. `main()`
  prints the crew's final output (or failure) to stdout/stderr, closing the
  selection runtime in `finally`; `withMcpRun`'s own `finally` closes the
  mounted registry and shuts down telemetry. Runs are rendered the same way
  as any other run: `bun run runs <id>`.

Optionally feeds **Slice 12** (memory/RAG, §11 below) via `runCrew`'s optional
`memory: MemoryStore` dep — members read/write it through a bound `recall`
tool + auto-persisted task output — and **Slice 13** (verification, §12): a
crew/task `verify` flag splices the grounded-verification sub-graph into the
compiled workflow, no new engine required. Out of scope (v1): CrewAI "Flows"
(our DAG already is that), planning / batch kickoff / human-in-the-loop tasks.

---

## 11. Memory/RAG (Slice 12)

A persistent, semantic memory layer — **`src/memory/`** — so agents can recall
facts across runs instead of starting cold each time. Composed on top of what
already exists (Model Manager for the embedder, guardrails' delegation context
for the injection budget, telemetry for spans) — **not a new resource-management
mechanism**.

### Two-tier store, space-scoped

- **LanceDB** (`lancedb-store.ts`, `LanceStore`) — embedded on-disk vector
  store, **one table per named *space*** (e.g. `default`, a per-project space).
  `namespace` (e.g. a crew id) and `kind` (`MemoryKind.RunMemory | Document`)
  are plain filterable **columns within a table**, not separate tables/spaces.
- **`bun:sqlite`** (`sqlite-store.ts`, `SqliteStore`) — two tables:
  - `spaces` — the **space registry**, one row per space:
    `{name, embedModel, embedDim, chunkCapTokens, createdAt}`. This row is the
    **authority** for a space's embedder — recall/write always defer to it, not
    to whatever `MemoryConfig.embedModel` the caller passes, so a space can't
    silently end up with mixed-dimension vectors.
  - `documents` — an **ingestion manifest scoped to `(space, source)`** (composite
    primary key `PRIMARY KEY (space, source)`), storing a content hash + chunk
    count. Ingesting the same path into two different spaces is tracked
    independently; ingesting an unchanged file a second time into the *same*
    space is a no-op (`seenDoc` short-circuits before any embedding work).
- **Embedder-bound-to-space rule:** `ensureSpace` probes the embed model's
  dimension the *first* time a space is touched and freezes it into the
  `spaces` row. `reindex(space, newEmbedModel)` is the **explicit, destructive**
  escape hatch — it drops the LanceDB table, clears the document manifest for
  that space, and re-probes/creates under the new embedder; re-ingesting
  content afterward is the caller's job (not automatic).

### Embedding (resource integration)

- **`embed.ts`** — `embedderDecl(model)` builds a **weights-only**
  `ModelDeclaration` (`kvBytesPerToken: 0` — an embedder has no KV cache to
  budget, unlike a chat model). `probeEmbedder(model)` reads dim + max-input via
  `POST /api/show` (mirrors `getModelMaxContext`), defaulting to `768`/`2048` if
  the architecture fields are absent. `makeEmbedder(deps)` returns an
  `embed(texts)` that calls `ensureReady(embedderDecl(model))` — so the
  embedder **shares the live RAM budget and LRU eviction** with every chat
  model the Model Manager already governs — then calls `RuntimeControl.embed`
  under a `memory.embed` span.
- **Default embedder:** `qwen3-embedding:0.6b` (`AGENT_MEMORY_EMBED_MODEL`
  fallback-only).
- **Chunking** (`chunk.ts`): semantic when an `embed` fn is supplied — splits on
  sentence boundaries, merges adjacent sentences while cosine similarity stays
  above a threshold (default 0.5) and the buffer is under the live char cap
  (`chunkCapTokens × 4 chars/token`, from the space's frozen `maxInput`);
  degrades to a fixed-size splitter when there's no embedder, only one
  sentence, or a semantic chunk still overflows the cap.

### Retrieval pipeline (`retrieve.ts`)

`retrieve(query, opts, deps)`, run inside a `memory.recall` span:

1. **Embed the query**, asserting its dimension matches the space's frozen
   `embedDim` (`MemoryError` on mismatch — catches a caller passing the wrong
   space/model).
2. **Dense vector search** via `LanceStore.hybridSearch` — despite the method
   name, search is **dense-only today**: `table.search(vector)` filtered by
   `namespace`/`kind`, returning LanceDB's raw `_distance` (lower = better).
   An FTS index (`Index.fts()` on the `text` column) is created best-effort at
   table-creation time so a later task can switch to hybrid BM25+dense (RRF
   fusion) without a migration, but that fusion is **not wired up yet** — this
   is a known, deliberate gap, not an oversight.
3. **Optional cross-encoder rerank** (`reranker.ts`) — **default-ON**
   (`defaultRerank()` returns true unless `AGENT_MEMORY_RERANK=0`). The Task-13
   spike validating `transformers.js` (`@huggingface/transformers`, ONNX
   runtime) under Bun on Apple Silicon **passed**, using
   `Xenova/bge-reranker-base` scored per `[query, doc]` pair, sorted descending
   — a cross-encoder reads query+doc jointly so its ranking fully replaces the
   incoming order (unlike RRF fusion). transformers.js manages its **own**
   model-weights cache — it is **not** routed through the Ollama Model Manager
   (only the embedder is). **Graceful degradation:** if the reranker throws
   (model download failure, OOM, etc.), `retrieve()` catches it, keeps the
   pre-rerank `_distance`-ascending order, records a `memory.rerank_failed`
   span event + `reranked=false`, and returns normally — a reranker failure
   never crashes recall.
4. **Budget-fit pack**: candidates are appended until `retrievalBudgetChars`
   (below) is spent, capped at `topK` (default 6, `AGENT_MEMORY_TOP_K`); the
   first candidate is always kept even alone-over-budget, so a hit never comes
   back empty due to budget alone.

**Injection budget** (`budget.ts`): `retrievalBudgetChars(callerNumCtx)` =
`floor(fraction × ctx × 4 chars/token)`, fraction default `0.25`
(`AGENT_MEMORY_CTX_FRACTION`, fallback-only) — the same shape as guardrails'
`returnCapChars` (§8), just a different fraction/purpose: this bounds how much
*retrieved memory* an agent's prompt absorbs, live off the **consumer's**
`num_ctx` (read from the active `DelegationContext` when the caller doesn't
pass one explicitly).

### Facade, tool, and anti-hallucination primitives

- **`store.ts`** — `createMemoryStore(config, deps)` is the single facade:
  `remember(text, opts)` (direct write, e.g. auto-persisted task output),
  `ingest(path, opts)` (hash-gated file ingestion), `recall(query, opts)`
  (space lookup → `retrieve()`; **returns `[]` — an explicit abstention, not an
  error — when the space doesn't exist yet**), `reindex(space, newEmbedModel)`,
  `stats()` (chunk counts per space), `close()`.
- **`recall-tool.ts`** — `makeRecallTool(store, ctx)` exposes `recall` as an AI
  SDK `tool()` an agent can call mid-run; `formatResults` renders each hit as
  `[mem:<id>] (<source>) <text>` — **citation-tagged** so an agent's answer can
  point at exactly which memory backs a claim. `injectRecall(store, ctx, task)`
  is the opt-in alternative: prepends recalled context to a task prompt
  up-front, fit to `retrievalBudgetChars`, returning the task **unchanged**
  when nothing is found. Both paths render `NO_MEMORY_FOUND = 'No supporting
  memory found.'` on an empty result — the same *abstain-over-fabricate*
  posture as `report_capability_gap`/`{kind:'resource'}` (§4/§5), extended from
  "no capability" to "no evidence." This slice shipped the two primitives
  (citation tags + abstention) that **Slice 13's verification layer builds
  on** — full faithfulness judging, Corrective RAG, and abstention wiring are
  documented in §12.
- **Crew/workflow wiring** (`src/crew/engine.ts`, `src/workflow/run-step.ts`):
  both `runCrew`/`runWorkflow` accept an **optional** `memory: MemoryStore` dep.
  When present: each crew member (or, for workflows, nothing automatic — the
  auto-persist is workflow-engine-side) gets a `recall` tool bound to
  `namespace = crew.id`, and each sequential task's / workflow step's
  validated output is auto-persisted via `autoPersistStepOutput` (namespace =
  crew/workflow id, `kind: MemoryKind.RunMemory`, opt-out per-task/-step via
  `persistMemory: false`, default on). This wiring is exercised by unit tests
  with an injected `MemoryStore`; **`flow.ts`/`crew.ts` do not yet construct
  a real store or expose a `--space` flag**, so end-to-end memory is not live
  on those CLIs yet — that's the natural follow-up once a slice needs it.

### CLI (`src/cli/memory.ts`)

`bun run memory ingest|recall|stats|reindex` — a standalone entry (mirrors
`flow.ts`/`crew.ts`'s lifecycle shape) that builds a **real**, Model-Manager
backed embedder + the default cross-encoder reranker (`makeRealStore`), then
dispatches: `ingest <path>` embeds+stores a file, `recall <query>` prints
retrieved chunks as JSON, `stats` prints per-space chunk counts, `reindex
<space> <newEmbedModel>` rebuilds a space under a different embedder. Flags:
`--space`, `--ns`, `--top`, `--embed`.

### Telemetry

`src/telemetry/spans.ts` extends per the standing rule (§7):
`withMemoryRecallSpan` (`ATTR.MEMORY_SPACE`/`MEMORY_NAMESPACE`/
`MEMORY_CANDIDATES`/`MEMORY_RETURNED`/`MEMORY_RERANKED`), `recordRerankOutcome`/
`recordRerankFailure` (update the reranked flag + a `memory.rerank_failed`
event after the fact), `withMemoryIngestSpan`, `withMemoryEmbedSpan`
(`ATTR.MEMORY_EMBED_MODEL`) — so `bun run runs` and any OTLP backend get
memory signal for free, same as every other subsystem.

### Module map additions

```
memory/ (types, budget, embed, chunk, sqlite-store, lancedb-store, retrieve,
         reranker, store, recall-tool, define)
  ← crew/engine.ts, workflow/run-step.ts   (optional recall tool + auto-persist)
  → resource/model-manager.ts               (ensureReady, weights-only embedder)
  → runtime (RuntimeControl.embed)          (Ollama embeddings endpoint)
  → telemetry/spans.ts                      (memory.recall/ingest/embed spans)
cli/memory.ts → memory/store.ts, memory/embed.ts, memory/reranker.ts, resource/model-manager.ts
```

`@lancedb/lancedb` (embedded vector store) and `@huggingface/transformers`
(cross-encoder rerank, ONNX runtime) are new dependencies; both are
self-contained (no external service to run).

---

## 12. Verification (Slice 13)

A **grounded-verification / anti-hallucination layer** — **`src/verification/`**
— built directly on the two Slice-12 primitives (citation tags, abstention):
it checks whether an answer's claims are actually **supported by the memory
chunks it cites**, and abstains rather than presenting an unsupported answer.
Composed on existing machinery (Model Manager for the judge model, the
workflow engine's step/branch mechanics, telemetry) — **not a new engine**.

### The `verify()` primitive (`verify.ts`)

`verify(answer, {query, space, threshold}, deps)`, run inside a
`verification.check` span:

1. **Decompose** (`claims.ts`, `decomposeClaims`) — the general/router model
   breaks the answer into atomic claim **texts** via a JSON-array prompt; a
   malformed/non-JSON response degrades to a **single whole-answer claim**.
   The LLM-returned `citedIds` on each claim are **not trusted for judging**
   (see below) — they're kept on the `Claim` type only as decomposition
   metadata.
2. **Parse citations deterministically** (`verify.ts`, `parseCitations` from
   `claims.ts`) — `allIds = parseCitations(answer)` regexes the ANSWER text
   itself for `[mem:<id>]` tags (stripping the `mem:` prefix). This replaced
   an earlier approach that unioned each claim's LLM-extracted `citedIds`,
   which was unreliable: the general model would sometimes return ids
   *with* the `mem:` prefix still attached (so `getByIds` found nothing) or
   omit them inconsistently, causing genuinely-grounded answers to be marked
   unsupported.
3. **Fetch the evidence pool** (`deps.getByIds(space, allIds)` → `src/memory`'s
   `getByIds`, §11) — a single pool of **every chunk the answer cites**, not a
   fresh retrieval and not scoped per-claim. If `allIds` is empty (the answer
   cites nothing), the pool is empty and every claim is unsupported by
   construction (`reason: 'no citation'`) without ever calling the judge
   model — this is what makes an uncited answer abstain.
4. **Per-claim judge call against the pool** (`judge.ts`, `checkClaim` +
   `verifyFaithfulness`) — every decomposed claim is checked with the same
   **MiniCheck-style** `(document, claim) → Yes/No` prompt against the **same
   pooled evidence string** (`[...evidenceById.values()].join('\n\n')`), using
   the **resolved judge model** (below), not the general model. Judging
   against the pool rather than a claim's own (LLM-extracted) `citedIds`
   avoids re-trusting the unreliable extraction step while still catching
   unsupported/hallucinated claims — MiniCheck says "No" when the pool
   doesn't entail the claim.
5. **Aggregate** (`verifyFaithfulness`) — `faithfulness = supportedCount /
   totalClaims`; `supported = faithfulness >= threshold` (default `0.9`,
   `AGENT_VERIFY_THRESHOLD`). Returns a `Verdict {supported, faithfulness,
   claims, unsupportedClaims, usedFallback}`.

`recordVerdict(verdict.unsupportedClaims.length)` annotates the
`verification.check` span after the fact (the span opens before the verdict
exists, since it wraps the judge-model resolution too).

### Faithfulness judge: a small checker, not a general-LLM judge

The judge model is **`bespoke-minicheck`** (`AGENT_VERIFY_MODEL` fallback-only)
— a small model **fine-tuned specifically** for the `(document, claim) →
supported?` task, not the router/general chat model doing double duty as a
judge. `claims.ts` (decompose) and `crag.ts` (retrieval grading) *do* use
`deps.generalModel` — only the per-claim faithfulness check is routed to the
dedicated checker.

### Consent-pull, then fallback — never a hard failure (`deps.ts`)

`ensureJudge(model)` (in `makeVerifyDeps`, the real Ollama/Model-Manager-backed
`VerifyDeps` factory):

- Already installed → use it directly.
- Not installed, `AGENT_VERIFY_AUTO_PULL=1` → pull silently, use it.
- Not installed, default policy (`autoPullPolicy() === 'prompt'`) and stdin is
  a TTY → **ask the user** (`pull bespoke-minicheck? [y/N]`); yes → pull and
  use it.
- Otherwise (declined, `AGENT_VERIFY_AUTO_PULL=0`, or non-interactive) → **fall
  back to `deps.generalModel`** for judging (`usedFallback: true`) and log a
  warning. Verification **never hard-fails** because the checker model isn't
  present — it degrades to a general-model NLI-style judge instead.

### Bounded Corrective RAG (`crag.ts`)

`gradeRetrieval(query, chunks, deps)` asks the general model to grade the
retrieved context `CORRECT | AMBIGUOUS | INCORRECT` (`CragGrade` enum).
`correctiveRetrieve(query, recall, deps)` rewrites the query
(`rewriteQuery`) and re-runs `recall` once **when a `recall` dependency is
wired**; otherwise, the rewrite happens but re-retrieval is skipped. **This is
one bounded, unrolled corrective step, not a loop** — the workflow/DAG engine
(§9) has no native looping construct, so CRAG here is expressed as a fixed
number of extra verify→corrective→verify steps spliced into the graph at
construction time (see `expand.ts` below), not a runtime `while` over the grade.
The current `--verify` CLI path re-answers without fresh retrieval (a documented
follow-up, mirroring the memory-store CLI gap).

### Verify→branch→corrective→abstain sub-graph (`expand.ts`)

`expandVerification(opts)` builds the actual step sequence appended after an
answering step `T` (types come from the workflow engine's new `StepKind.Verify`,
§9):

```
T                        (the existing answer step; caller keeps it)
T__verify    Verify      verify(ctx[T])                  → Verdict
T__branch    Branch      supported? → T__pass | T__corrective
T__pass      Verify(pass)  no-op terminal (accept)
T__corrective Verify(corrective)  CRAG rewrite + re-answer (re-recall if recall wired) → string
T__verify2   Verify      verify(ctx[T__corrective])      → Verdict
T__branch2   Branch      supported? → T__pass2 | T__abstain
...
T__abstain   Verify(abstain)  writes an UnverifiedMarker  → marker
```

With `maxRetries` (default `1`, `AGENT_VERIFY_MAX_RETRIES`) corrective
attempts, the `(corrective → verify → branch)` block **repeats as a fixed
unrolled chain** — never a real loop — and the final gate's `whenFalse` always
routes to the single `abstain` terminal. `maxRetries=0` collapses straight to
`verify → branch → (pass | abstain)`. A plain task/workflow that never opts
into `verify` is byte-identical to pre-Slice-13 output — this is purely
additive.

### Abstention (`{kind:'unverified'}`)

When the final gate fails, `T__abstain` writes an `UnverifiedMarker
{__unverified: true, answerStepId, unsupportedClaims, faithfulness, draft}`
into the workflow context instead of the draft answer. `workflow/engine.ts`
and `crew/engine.ts` scan the finished context for this marker
(`findUnverified`) and, if present, return `{kind:'unverified', ...}` on
`WorkflowOutcome`/`CrewOutcome` **in place of** the normal `done` outcome —
the unsupported draft is captured for inspection but never presented as if it
were a trustworthy answer, the same abstain-over-fabricate posture as
`report_capability_gap`/`{kind:'resource'}` (§4/§5) and memory's empty-recall
abstention (§11).

### Opt-in wiring: `--verify`

Verification is **off by default** and additive at every layer:

- **Types**: `AgentStep.verify?: boolean` (workflow, `src/workflow/types.ts`)
  and `Task.verify?` / `CrewDef.verify?` (crew, `src/crew/types.ts` — a
  crew-level `verify: true` is equivalent to setting it on every task).
- **Compile-time splice**: given `verifyDeps` (workflow: passed to
  `runWorkflow`; crew: `CrewDeps.verifyDeps`, forwarded into
  `compileToWorkflow`), a step/task flagged `verify` gets its answer step
  expanded via `expandVerification` before the DAG is validated — so
  verification participates in the same construction-time acyclicity checks
  as everything else.
- **CLI**: `--verify` on `bun run crew <name>`/`bun run flow <name>`
  constructs the **real** `VerifyDeps` (`src/cli/verify-runtime.ts`,
  `makeRealVerifyDeps` — Ollama-backed `generate`, the real memory store's
  `getByIds`, `ensureJudge` wired to the real runtime control) and forces
  `verify: true` on every task/step. On an `unverified` outcome, the CLI
  writes `runs/<id>/unverified.txt` (task id, faithfulness, unsupported
  claims, the abstained draft) and **exits non-zero** instead of printing the
  draft as the answer.

### Known limitation: verify is designed for the terminal task

`expandVerification` splices its sub-graph **after** the flagged step, so a
downstream step that depends on that step's output reads the **original,
possibly-unverified** context value — the corrective re-answer / abstain
marker live under new step ids (`T__corrective`, `T__abstain`), not `T`
itself. Verify is therefore designed for **the terminal answering step** of a
workflow/crew (where nothing downstream consumes its output); using `verify`
on a **mid-graph** step is a documented limitation, not a supported pattern,
in this slice — downstream deps do not automatically see the corrected or
abstained value.

### Telemetry

`src/telemetry/spans.ts` extends per the standing rule (§7):
`withVerificationSpan` (`ATTR.VERIFICATION_SUPPORTED` /
`VERIFICATION_FAITHFULNESS` / `VERIFICATION_CRAG_GRADE` /
`VERIFICATION_RETRIES` / `VERIFICATION_FALLBACK`) and `recordVerdict`
(`ATTR.VERIFICATION_UNSUPPORTED`) — so `bun run runs` and any OTLP backend get
per-claim faithfulness signal for free, nested under `workflow.step`/`crew.run`
like every other subsystem.

### Eval gate: in-repo golden set, no external framework

`tests/verification/faithfulness.eval.test.ts` runs `verify()` over an
**in-repo golden set** (`tests/verification/golden/cases.json`, ~15–20 cases
spanning grounded / hallucinated / uncited / no-evidence categories) with an
offline stand-in judge — **no RAGAS or other external eval framework** is
wired in; the gate is our own primitive exercised against our own fixtures.
`tests/integration/verification.live.test.ts` is a `.live` test
(`describe.skipIf(!ready)`) that round-trips a real `bespoke-minicheck` pull +
call, and skips cleanly when the model isn't available rather than failing
the suite.

### Out of scope (deferred)

Chain-of-Verification (CoVe) for complex multi-step answers, semantic-entropy
/ SEP-style uncertainty estimation, self-consistency sampling, external eval
frameworks (RAGAS, etc.), Self-RAG, generation-time citation constraints (this
slice checks citations post-hoc, it doesn't constrain generation to emit
them), and per-task `--verify` granularity at the CLI (today `--verify` is
all-or-nothing across a crew/workflow run).

### Module map additions

```
verification/ (types, config, claims, judge, crag, verify, expand, deps)
  ← workflow/engine.ts, crew/engine.ts   (StepKind.Verify, findUnverified → {kind:'unverified'})
  ← cli/crew.ts, cli/flow.ts             (--verify → makeRealVerifyDeps, unverified.txt)
  → memory/store.ts (getByIds)           (cited-evidence lookup)
  → resource/model-manager.ts            (ensureReady for the judge/general model)
  → runtime (RuntimeControl.isInstalled/pull)  (consent-pull the judge model)
  → telemetry/spans.ts                   (verification.check span + ATTR.VERIFICATION_*)
```

---

## 13. Provisioning (Slice 14)

A **first-boot / on-demand model provisioning layer** — **`src/provisioning/`**
— that discovers which local models fit the host, gets per-model consent, and
downloads them through a runtime-agnostic adapter with live progress. It does
**not** replace the Model Manager (§4/§5): provisioning only gets weights onto
disk / into the Ollama store; the existing `ensureReady`/selector path is what
loads and serves a model once it's present. `runProvision` never calls
`ensureReady` itself.

**Live-verify status (read this before trusting any adapter claim below):
Ollama is live-verified end-to-end** (Tasks 2 and 4 — fresh `qwen3.5:9b` /
`qwen3-embedding:0.6b` pulls to 100%, delete+re-provision idempotent). **LM
Studio, llama.cpp, and MLX are contract-tested only — live-verify is
deferred**, since none of those runtimes is installed on the dev machine
(tracked as a Slice-14 follow-on in `docs/ROADMAP.md`, not a silent gap).

### Two-tier `DownloadProvider` model (`types.ts`)

`DownloadPhase` (`Resolving → Downloading → Verifying → Finalizing → Done |
Failed`) and `DownloadProgress` (`modelRef, phase, bytesCompleted, bytesTotal
| null, percent | null, speedBytesPerSec | null, error?`) form one normalized
progress protocol every adapter emits. `DownloadProvider = { kind:
ProviderKind, download(modelRef, {onProgress, signal}) }` — one adapter per
runtime, injectable, so the orchestrator and tests never see runtime-specific
shapes.

### The adapters (`src/provisioning/providers/`)

- **`ollama.ts`** (`createOllamaProvider`) — streams `/api/pull{stream:
  true}`, normalizes lines via `OllamaPullAggregator`/`ProgressTracker`
  (`ollama-pull.ts`, `progress-tracker.ts`), wraps the attempt in a
  `StallWatchdog` (aborts a stalled transfer) plus `withRetry` full-jitter
  abortable backoff (`supervisor.ts`), throws `ProviderError` on an in-band
  `{error}` line, and confirms the install actually landed
  (`isModelInstalled`) before declaring success. **Live-verified.**
- **`hf-fetch.ts`** (`createHfFetchProvider`) — a runtime-agnostic HTTP
  downloader shared by llama.cpp (GGUF single-file, `repo::file` modelRef
  convention) and MLX (whole-snapshot, bare `repo` modelRef). **Contract-tested
  only; shape-complete, not download-complete**: it streams the HF resolve
  response, counts bytes, and reports Resolving → Downloading → Verifying →
  Done — but it reads the body via `reader.read()` and **discards the bytes**;
  there is no `.part` file and no atomic rename, so **nothing is persisted to
  disk yet**. The `Verifying` phase calls an injected `sha256(path)` only if
  the caller supplies one; the default path has no hash step, and even a
  supplied hash would be computed over a file that generally doesn't exist,
  since nothing was written. **You cannot download a GGUF or MLX model to disk
  with this adapter today** — the real disk-write + real SHA256 verification
  are deferred to the live-verify pass once a real runtime is installed.
- **`lmstudio.ts`** (`createLmStudioProvider`) — POSTs
  `/api/v1/models/download`, polls job status, normalizes into the same
  progress protocol. **Contract-tested only, live-verify deferred** (LM
  Studio not installed on the dev machine). The REST surface it targets is
  undocumented/best-effort per research at authoring time, not a stable
  public API. It is **not wired into `registry.ts`'s `providerFor`** — LM
  Studio isn't a distinct `ProviderKind` (it shares `MlxServer` with the
  HF-fetch adapter), so `providerFor(MlxServer)` currently resolves to
  `createHfFetchProvider`, not `createLmStudioProvider`. The LM Studio adapter
  exists and is tested but is not yet reachable from the orchestrated flow —
  a real integration decision (which adapter serves `MlxServer` on which host)
  is part of the deferred live-verify work.

### Two-phase catalog discovery + snapshot fallback (`catalog/`, `registry.ts`)

`catalogSourcesFor(host)` wires two dynamic, per-runtime sources, each wrapped
in `withSnapshotFallback`:

- **`ollama-catalog.ts`** — `createOllamaCatalogSource` lists a community
  JSON catalog (list-only, `fileSizeBytes: 0` placeholders); `ollamaManifestSize`
  sums the real registry manifest's `layers[].size` (+`config.size`) for
  authoritative pre-pull sizing once a candidate is enriched.
- **`hf-catalog.ts`** — `createHfCatalogSource` searches the HF models API
  (`gguf`/`mlx` filter by kind); `hfTreeSize` sums the HF tree API's file
  sizes for a single file or a whole snapshot. `HF_TOKEN` is env-fallback-only
  (anonymous if absent).
- **`snapshot.json` + `snapshot-source.ts`** — 4 committed bootstrap entries
  with real recorded sizes (`qwen3.5:4b`, `qwen3.5:9b`, `qwen3-embedding:0.6b`,
  `bespoke-minicheck`). `withSnapshotFallback(source, snap)` degrades to the
  snapshot on a source **throw or an empty list** — degrade-never-crash, and
  discovery still works offline or when an upstream catalog is unreachable.

Discovery is a **dynamic, per-runtime query with a committed-snapshot floor**,
not a purely static list.

### Fit + rank (`fit.ts`)

`fitAndRank(candidates, budgetBytes)` computes `estimatedBytes = max(
fileSizeBytes, estimateModelBytes({paramsBillions, bytesPerWeight,
contextTokens: 8192, kvBytesPerToken}))` (weights + KV at a **fixed 8192-token
sizing context**, not the live `num_ctx` — a deliberate simplification so
ranking doesn't depend on which agent asks), filters to `fitsBudget`, ranks by
`footprint.approxParamsBillions` descending, and marks the top-per-`ProviderKind`
candidate `recommended` — **skipping unenriched 0/0 placeholders** so a
phantom, never-sized catalog entry is never auto-preselected.

### Supervisor guards (`supervisor.ts`)

`checkDiskSpace` (shortfall/headroom preflight — Ollama itself doesn't
preflight disk and fails mid-download), `withRetry` (full-jitter exponential
backoff, abortable via `AbortSignal`), `StallWatchdog` (aborts a download
whose byte count hasn't advanced within a timeout).

### Orchestration (`provisioner.ts`, `runProvision`)

`detectHost()` → discover across applicable catalog sources (per-source
`.catch(() => [])` degrade) → `fitAndRank` → **early-return if nothing fits**
→ lazily enrich sizes for the ranked set → per-model consent via
`deps.ui.selectModels` (recommended pre-selected) → **early-return if nothing
selected** → disk preflight (`checkDiskSpace`; short-on-space prompts
"continue anyway?", declining is a third early-return) → **sequential**
downloads with one live progress bar, each model's failure caught
individually into `result.failed` so one bad pull never crashes the run or
blocks the rest. All dependencies are injectable (`ProvisionDeps`) for
testability. The three early-return paths (nothing fits / nothing selected /
declined preflight) are no-op runs and deliberately do **not** open a
provisioning span — only an actual download attempt does.

### Dependency-free UI (`src/provisioning/ui/`)

`format.ts` (byte/speed/ETA formatting), `progress-bar.ts` (TTY `\r`-rewrite
vs non-TTY line-per-update), `prompt.ts` (`askYesNo`/`selectModels`, testable
via injected stdin, `autoYes` short-circuit for `AGENT_PROVISION_AUTO_YES=1`).

### CLI + auto-detect hook

`bun run provision` (`src/cli/provision.ts`) is the explicit entry point.
`cli-deps.ts` has the shared `buildProvisionDeps`/`freeDiskBytes` wiring reused
by both `provision.ts` and a `chat.ts` auto-detect hook
(`maybeAutoProvision`): TTY + consent gated via `detectMissing` (comparing
`BOOTSTRAP` declarations against `isModelInstalled`) — it only nudges when
something declared is missing, and only in an interactive terminal; it never
silently downloads. **Consent before pull is a hard product rule** here
(never speculative).

### Telemetry

`src/telemetry/spans.ts` extends per the standing rule (§7):
`withProvisionSpan` opens an `agent.model.provision` span around the download
loop only, tagged up front with `ATTR.PROVISION_CANDIDATE_COUNT`/
`PROVISION_SELECTED_COUNT`/`PROVISION_BYTES_TOTAL`/`PROVISION_SNAPSHOT_FALLBACK`
and updated after the loop with `PROVISION_DOWNLOADED_COUNT`/
`PROVISION_FAILED_COUNT`. `snapshotFallback` is currently always recorded as
`false` from `runProvision` — the provisioner itself doesn't see whether a
`catalogSourcesFor`/`withSnapshotFallback` source actually fell back
internally (that decision is made inside `registry.ts`/`snapshot-source.ts`
and isn't threaded back out); this is an honest default, not a fabricated
plumbing path, and is a candidate for a future refinement rather than
something this slice claims to track precisely today.

### Data flow

`bun run provision` (CLI) or the `chat.ts` auto-detect hook →
`Provisioner.runProvision` → `CatalogSource`s (discovery, with snapshot
fallback) + `DownloadProvider`s (`registry.ts` `providerFor`) → on success,
weights are on disk / in the Ollama store, available for
`RuntimeControl`/`resource/model-manager.ts`'s `ensureReady` (§4/§5) to pick
up on the **next** normal chat/crew/workflow run. Provisioning does not itself
call `ensureReady`.

### Module map additions

```
provisioning/ (types, fit, provisioner, registry, supervisor, progress-tracker,
               providers/{ollama,hf-fetch,lmstudio}, catalog/{ollama-catalog,
               hf-catalog,snapshot-source,snapshot.json}, ui/{format,
               progress-bar,prompt}, cli-deps, detect-missing, ollama-pull)
  ← cli/provision.ts                     (bun run provision → runProvision)
  ← cli/chat.ts                          (maybeAutoProvision, TTY+consent gated, optional)
  → resource/footprint.ts, resource/hardware.ts  (fit.ts: estimateModelBytes, fitsBudget)
  → resource/ollama-control.ts           (providers/ollama.ts: isModelInstalled confirm)
  → discovery/catalog-source.ts          (Candidate/CatalogSource/HostCapabilities types)
  → core/types.ts                        (ProviderKind)
  → telemetry/spans.ts                   (agent.model.provision span + ATTR.PROVISION_*)
```

---

## 14. MCP mount registry & starter pack (Slice 15)

Slice 3 hardcoded two mounts (`createFileTools`, `createFetchTools`) straight
into `chat.ts`. Slice 15 replaces that with a **declarative registry**: a
committed `mcp.json` (the standard `mcpServers` shape plus one extension field,
`agents`) lists every server; a **consent gate** approves each one once and
**pins** its tool definitions against tampering; a **curated starter pack**
gives `bun run mcp add <name>` a one-line path to twelve maintained servers.
This is Phase C's "integration library" and the palette Phase D's
agent-builder will suggest from.

### Module map (`src/mcp/`, `src/cli/mcp.ts`)

- **`types.ts`** — `McpTransportKind` (`Stdio`/`Http`), the raw Zod schemas (`stdioEntrySchema`/`httpEntrySchema`), the validated `StdioServerEntry`/`HttpServerEntry` union (`McpServerEntry`, each carrying the as-written `raw` value alongside the env-expanded fields), `McpConfig` (`entries`/`dormant`/`warnings`), and `PackEntry`.
- **`config.ts`** — `loadMcpConfig(path, env)`: reads `mcp.json` (default `./mcp.json`, override `AGENT_MCP_CONFIG`), expands `${VAR}`/`${VAR:-default}` (`expandVars`), and degrades per-entry rather than throwing — a malformed entry warns and is skipped, an entry with an unresolved required var goes to `dormant`, and a VS-Code-style `servers` root (instead of `mcpServers`) is tolerated with a warning.
- **`consent.ts`** — `specHash` (identity hash over raw command/args/env-**key-names**, or url/header-**names** — never values, so secrets are never hashed or stored), `toolsHash` (fingerprints the live tool set: name+description+schema), `ensureConsent` (the gate itself), `pinTools`/`checkDrift` (the rug-pull check), `dangerFlags` (sudo / `rm -rf` / curl\|sh pattern warnings), and `readApprovals`/`writeApprovals` against `.mcp-approvals.json` (git-ignored, atomic temp+rename write).
- **`mount.ts`** — `mountAll(config)`: for each entry, consent-gate → mount (stdio or HTTP) → hash + drift-check + pin → collect. Returns a `MountedRegistry` — `merged` (every tool, for workflow tool-steps), `forAgent(name)` (unscoped entries + entries naming that agent — the per-agent slice), `mounted`/`skipped` (for status/telemetry), `close()`. Also `warnUnknownAgents` — a typo guard for an `agents` entry naming an agent that doesn't exist.
- **`pack.ts`** — `STARTER_PACK`: 12 capability-tagged entries (`file-tools`, `sqlite`, `filesystem`, `memory`, `sequential-thinking`, `fetch`, `git`, `time`, `playwright`, `github`, `brave-search`, `exa-search`), 2026-07 verified to exclude servers the MCP org archived in 2025 (the official sqlite/postgres/brave/puppeteer/github packages). `getPackEntry`/`packByCapability` for programmatic lookup.
- **`client.ts`** — unchanged integration primitive: `mountMcpServer(spec)` connects to any stdio or Streamable-HTTP server and returns `{tools, close}`. The original `createFileTools`/`createFetchTools` presets still live here as thin wrappers but are no longer called by any CLI — the registry replaced them.
- **`server.ts`** / **`sqlite-server.ts`** — the two in-repo servers: `read_file` (stdio), and `query` (SELECT-only) / `execute` (writes) / `schema` on `bun:sqlite` (the `sqlite` pack entry defaults to `data/agent.db`; `bun:sqlite` itself does not create parent directories, so `sqlite-server.ts` calls `mkdirSync(dirname(dbPath), { recursive: true })` before opening the database — fixed pre-merge in Slice 15 final review so a bare clone's first `sqlite` mount succeeds without a manual `mkdir -p data`).
- **`src/cli/mcp.ts`** — `bun run mcp list` (pack + in-config state), `bun run mcp status` (configured servers, dormant reasons), `bun run mcp add <name>` (copies a pack entry's `server` value into `mcp.json`, atomic write, refuses to overwrite an existing key).

### Load → consent → mount → pin → attach

All three CLIs (`chat.ts`, `flow.ts`, `crew.ts`) run the same startup
sequence via `src/cli/with-mcp-run.ts`'s `withMcpRun` (Slice 16): `createRun`
→ `initRunTelemetry(run.dir)` → `loadMcpConfig()` (outside any span) →
`mountAll(config)`, with only that `mountAll` call wrapped in
`withMcpMountSpan` (§ Telemetry below) — establishing the run dir
and its telemetry provider **before** mounting, so the mount span is
recorded against that run's tracer (see § Telemetry for why the ordering
matters). Inside `mountAll`, each entry goes through `ensureConsent` — a TTY
prompt showing the exact command/URL (from `raw`, so secrets behind `${VAR}`
are never displayed) plus any danger flags. Interactivity is judged by
`interactiveTTY()` (`src/provisioning/ui/prompt.ts`, Slice 16), which
requires **both** stdin (the stream the answer is read from) and stderr (the
stream the question is written to) to be TTYs — judging on stderr alone let
`cmd < /dev/null` hang on an already-ended stdin; `stdinInput()` also now
resolves `''` on the stream's `end` event instead of leaving the read
promise pending forever, closing that hang from the other side too.
Non-interactively it skips with a warning unless `AGENT_MCP_AUTO_APPROVE=1`
(the CI/headless path, also used by the Slice-15 Task-6 live-verify below).
An approved entry is mounted, its live tool
definitions are hashed and pinned (or, if a previously-pinned hash no longer
matches, re-approval is requested — `list_changed` notifications are not
handled; **pinning + optional re-prompt is the posture** for detecting a
changed tool surface between runs). The resulting registry hands each agent
`forAgent(name)` — its own tools plus any unscoped ("all agents") entries —
while workflow tool-steps dispatch against the full `merged` set.

### Spec-hash / tools-hash pinning (the rug-pull defense)

Two independent hashes protect two different moments. `specHash` is computed
from the **raw, unexpanded** config (command/args/env-key-*names*, or
url/header-*names*) — never a secret value — so `.mcp-approvals.json` (never
committed) records *that* a server was approved and *what its identity was*,
without ever storing credentials; a changed `specHash` re-triggers consent.
`toolsHash` is computed after mounting, from the live tool definitions
(name + description + JSON schema); if a server that was already approved and
pinned later serves different tools — a "rug-pull" — `mountAll` detects the
mismatch via `checkDrift` and re-prompts (or, non-interactively without
auto-approve, declines and skips the server) rather than silently trusting a
changed capability surface.

### Dormant until key

A pack/config entry naming `requiresEnv` vars that aren't set — `github` →
`GITHUB_PAT`, `brave-search` → `BRAVE_API_KEY`, `exa-search` → `EXA_API_KEY`
— is parsed successfully but marked **dormant**, never attempted: no process
spawn, no HTTP call, no consent prompt. `bun run mcp status` lists dormant
entries separately with the missing variable name(s); `bun run mcp add`
notes the dormancy inline at add-time.

### The pack as a Phase-D palette

`STARTER_PACK`'s `description`/`capabilities` fields are written to be
**queried by a future consumer**, not just read by a human running
`bun run mcp list`: the Phase-D agent-builder's job — "describe a need → the
system grows the capability" — includes suggesting *which* MCP server to
mount for a reported capability gap, and `packByCapability(cap)` is that
lookup already in place, ahead of the agent-builder itself.

### Scoping eval

`tests/mcp/eval-scoping.test.ts` (Ollama-gated, `describe.skipIf`) is the
evidence behind the per-server `agents` field: a `file_qa`-scoped agent
(`SCOPED = {read_file}`) is compared against a merged toolset carrying eight
plausible distractors (fetch/query/execute/git_log/browser_navigate/
create_entities/get_time alongside `read_file`) across four file-reading
prompts, run against `qwen3.5:9b` (`qwenFast`). The **scoped** case is
asserted (`≥3/4`, avoiding a flaky gate on an occasional miss); the merged
case is only logged for comparison, since a strong tool-calling model can
mask the benefit a weaker/router model would need. Slice-15's own eval run:
scoped 4/4, merged 4/4 — the model used (`qwen3.5:9b`) is strong enough that
both sets picked correctly every time in this run, so the comparison did not
demonstrate a scoped-vs-merged accuracy *gap* on this occasion; the assertion
still guards against a regression, and the merged number remains logged for
future runs (a smaller/weaker router model would be expected to show the gap
more often).

### Telemetry

`withToolSpan(toolName, fn)` wraps a workflow `Tool`-kind step in a
`workflow.tool` span tagged `gen_ai.tool.name` — closing the gap where
`StepKind.Tool` steps previously ran untagged. `withMcpMountSpan(fn)` wraps
one mount pass in an `mcp.mount` span; the callback records one
`mcp.server.mount` event per server (`mcp.server`, `mcp.mount.outcome` —
`mounted`/`dormant`/a skip reason —, and `mcp.tool.count` when mounted), and
the span itself gets two attributes set at the end (both corrected in
Slice 16): `mcp.server.count` — the number of servers actually mounted —
and `mcp.tool.count` — the **sum** of those mounted servers' tool counts
(previously this held a raw per-call record count with no clear meaning).

**Run-telemetry ordering (fixed, Slice 16):** `src/cli/with-mcp-run.ts`'s
`withMcpRun(opts, body)` now owns the per-run CLI scope end to end, in one
place, in this order: `createRun` → `initRunTelemetry(run.dir)` →
`withMcpMountSpan(mountAll(...))` → `body({run, reg, config})` → `finally {
reg.close(); tel.shutdown() }`. Because the run's `BasicTracerProvider` is
registered **before** `mountAll` runs, the `mcp.mount` span (and its
`mcp.server.mount` events) is created against that run's tracer and reaches
`runs/<id>/spans.jsonl` alongside `workflow.tool`/`ai.toolCall`/`agent.run`.
Previously (Slice 15), each CLI's `main()` ran `withMcpMountSpan`/`mountAll`
**before** calling `createRun`/`initRunTelemetry` (which only happened
inside `runFlow`/`runChat`/`runCrewCli`), so the mount span was recorded
against whatever tracer was globally active at that point — the OTel no-op
default on a fresh process — and never appeared in the run's span file. All
three CLIs' `main()`s now call `withMcpRun` and their run functions
(`runFlow`/`runCrewCli`/`runChat`) now take a `run: RunHandle` from the
caller instead of creating one themselves, so the ordering invariant lives
in this one helper rather than being duplicated (and previously
mis-ordered) three times. `ATTR.MCP_TRANSPORT` is defined in the `ATTR`
registry but **not yet set on any span** — a follow-up, not a current
signal.

### Live-verify (Slice 15 Task 6)

With real Ollama up: `bun run mcp list` rendered all 12 pack entries;
`bun run mcp add git`/`add sqlite` + `bun run mcp status` round-tripped
correctly; `bun run flow fetch-then-summarize` and `bun run crew
research-crew` both mounted the registry (`git`/`sqlite` alongside the
committed `file-tools`/`fetch`) under `AGENT_MCP_AUTO_APPROVE=1` (the
headless consent path — interactive TTY consent-prompt UX is **not**
exercised by this non-TTY verify pass and is deferred to the user's own
first interactive run); `.mcp-approvals.json` persisted and a second run
did not re-prompt. `bun run src/cli/chat.ts "what is in package.json?"`
correctly delegated to `file_qa`, which called `read_file` (the model chose
an absolute path and got `ENOENT` — a prompting/path issue independent of
the registry). The `sqlite` pack entry failed to mount in all three runs
because `data/` didn't exist on this checkout — mounting degraded
per-entry as designed; the other three servers were unaffected. Fixed
pre-merge in Slice 15 final review: `sqlite-server.ts` now creates its
db's parent directory before opening it (see §14 above and
`docs/ROADMAP.md` "Slice 15 follow-ons"), so this no longer reproduces.
GitHub's remote HTTP server was **not** live-verified — no `GITHUB_PAT` set
on this machine — logged-deferred per the ledger.

---

## 15. On-disk stores

- **`runs/<runId>/`** (git-ignored) — `spans.jsonl` (the OTel trace, canonical) + `answer.txt` / `gap.txt` / `resource.txt` / `unverified.txt` (human-facing artifacts; the last written on a Slice-13 `--verify` abstention). `runId = run-<pid>`. Read by the run-viewer; override the root with `AGENT_RUNS_ROOT` (tests).
- **`model-images/`** (git-ignored) — the project-local Ollama model store (`OLLAMA_MODELS`, set by `serve.sh`) + `catalog.json` (discovery output: `{ writtenAt, candidates[] }`, atomic temp+rename).

---

## 16. Testing strategy

- **Agent loop / core** — `MockLanguageModelV3` (no model needed); step-ceiling → `MaxStepsError`.
- **Guardrails** — pure unit tests (depth allow/reject, recursion-allowed, live `returnCapChars`, `concise`, ALS propagation) + a synthetic multi-hop `delegate.test.ts` (an agent given a delegate tool) proving over-depth soft-error + event and the live cap, since real multi-hop isn't reachable yet.
- **Telemetry** — `tests/helpers/otel-test-provider.ts` `registerTestProvider()` (InMemory exporter); asserts spans/events/attrs; a Bun ALS-nesting smoke test.
- **Resource / Ollama control** — `fetch` mocked; bodies/URLs asserted; warm-reuse regression (two agents, one warm).
- **MCP** (`tests/mcp/`) — pure unit tests per module (`types` via `config`/`consent`/`mount`/`pack`) with injected fakes for consent/mount deps; **real stdio subprocess round-trips** against both in-repo servers (`server.test.ts` for `read_file`, `sqlite-server.test.ts` for `query`/`execute`/`schema` on a temp-dir `bun:sqlite` file); a **real HTTP round-trip** (`mount-http.test.ts` spins up a local `node:http` + `StreamableHTTPServerTransport` server and mounts it over Streamable HTTP, no subprocess); `cli-add.test.ts` drives `bun run mcp add` end-to-end against a temp `mcp.json`; `tool-span.test.ts` asserts `withToolSpan`/`withMcpMountSpan` pass results through and propagate errors against the no-op tracer (no provider registered); `tool-span-emission.test.ts` registers a real `registerTestProvider()`-backed provider and asserts the actual emission — `withToolSpan` produces a `workflow.tool` span with `gen_ai.tool.name` set, and `withMcpMountSpan` produces an `mcp.mount` span carrying an `mcp.server.mount` event with `mcp.server`/`mcp.mount.outcome`; `eval-scoping.test.ts` is the live, Ollama-gated scoping eval (§14); `tests/cli/with-mcp-run.test.ts` (Slice 16) asserts the ordering fix directly against a real JSONL file — after `withMcpRun`, `runs/<id>/spans.jsonl` contains an `mcp.mount` span — and that the registry is closed after the body runs.
- **Memory** (`tests/memory/`) — pure unit tests per module (`define`, `budget`, `chunk`, `embed`, `sqlite-store`, `retrieve`, `recall-tool`, `spans`) with injected/mock deps (no Ollama/LanceDB needed for most); `lancedb-smoke.test.ts` exercises the real embedded LanceDB against a temp dir (no network); `reranker.spike.test.ts` is the outcome-gating spike for the transformers.js cross-encoder (records whether it's viable, not a permanent live-skip test); `wiring.test.ts` covers the optional crew/workflow `memory` dep (recall tool binding + auto-persist); `tests/cli/memory.test.ts` drives `runMemoryCli` end-to-end against an injected store; `tests/integration/memory.live.test.ts` needs real Ollama + the embed model pulled.
- **Verification** (`tests/verification/`) — pure unit tests per module (`verify.test.ts`) with injected `VerifyDeps` (no Ollama needed); `faithfulness.eval.test.ts` is the in-repo golden-set eval gate (`tests/verification/golden/cases.json`, ~15–20 cases, offline stand-in judge — no external eval framework); `tests/crew/verify-wiring.test.ts` + `tests/workflow/verify-wiring.test.ts` cover the compile-time splice + `{kind:'unverified'}` outcome mapping; `tests/integration/verification.live.test.ts` needs a real `bespoke-minicheck` pull.
- **Provisioning** (`tests/provisioning/`) — pure unit tests per module (`fit`, `supervisor`, `progress-tracker`, `provisioner`, `ollama-pull`, `ollama-catalog`, `hf-catalog`, `snapshot-source`, `hf-fetch`, `lmstudio`, `ui-format`, `ui-prompt`, `detect-missing`) with injected fakes (no real network/runtime for any of them); `eval.test.ts` is the fit-selection golden set across RAM tiers plus a telemetry-emission assertion for `agent.model.provision` (`registerTestProvider`). Ollama's adapter is additionally **live-verified** in the Slice-14 ledger (fresh pull to 100%, idempotent re-provision); the HF-fetch and LM Studio adapters are contract-tested only — no `*.live.test.ts` exists yet for provisioning pending a runtime install.
- **Live** (`*.live.test.ts`, skip when the dep is down) — `orchestrator`, `model-manager`, `selection`, `kv-cache`, `fetch-mount`, `run-viewer`, `workflow`, `crew`, `memory`, `verification` (real Ollama); `discover` (real HF); `mlx` (needs an MLX server).

---

## 17. Glossary

- **Agents-as-tools** — the orchestrator (`agents/super.ts` via `createOrchestrator`) exposes `delegate_to_<name>(task)` tools wrapping sub-agents + `report_capability_gap`. Routing = the router model's tool choice. `runOrchestrator` returns `{answer|gap|resource}` (resource/gap take precedence over an answer, read from `steps` even when the step guard trips).
- **Run** — one invocation under `runs/<id>/`: an OTel trace (`spans.jsonl`) + text artifacts.
- **Span / trace** — OpenTelemetry units. A run = a root `agent.run` span; delegations, model loads, and AI-SDK `generateText`/tool calls nest beneath it via the active async context. `bun run runs` renders the tree.
- **Delegation context** — the `AsyncLocalStorage` `{depth, ancestors, numCtx}` threaded through every hop; basis for the depth guard, the live return cap (off the parent's `numCtx`), and the `delegation.depth`/`ancestors` span attrs.
- **Live budget** — `min(0.75 × total RAM, 0.8 × availableRamBytes())` (first term = the Metal cap), recomputed per delegation; `availableRamBytes()` parses `vm_stat`.
- **Dynamic num_ctx** — `min(desired, modelMax, maxCtxByFit)`, floor 4096, rounded 1024; `modelMax` probed live via `/api/show`; same value for warm + inference.
- **Model Manager** — `src/resource/model-manager.ts`; `ensureReady` drives the lifecycle within live budget and returns the chosen context. State keyed by model string ⇒ shared-model agents = one resident copy.
- **Mounting an MCP server** — `mountMcpServer(spec)` (`client.ts`) connects to any stdio or Streamable-HTTP MCP server and returns `{tools, close}`. Capability = pointing at a server, not writing tool code. Slice 15 replaced the two Slice-3 hardcoded presets (`createFileTools`/`createFetchTools`, still in `client.ts` but no longer called by any CLI) with a declarative `mcp.json` **registry** (`config.ts`) plus a 12-entry curated **starter pack** (`pack.ts`, `bun run mcp list\|status\|add`); every mount is consent-gated (`consent.ts`, `.mcp-approvals.json`) and its tool definitions are hashed and pinned to catch drift between approval and reuse (§14).
- **Declaration** — a data file describing a model (provider + name + params + footprint) or an agent. Not weights, not logic.
- **MiniCheck** — `bespoke-minicheck`, a small model fine-tuned for `(document, claim) → supported?` fact-checking; Slice 13's default faithfulness judge, distinct from the general/router model used elsewhere.
- **CRAG (Corrective RAG)** — grade retrieved context `CORRECT/AMBIGUOUS/INCORRECT`, and if weak, rewrite the query and re-retrieve once before re-answering. Shipped in Slice 13 as one bounded, unrolled corrective step (not a runtime loop).
