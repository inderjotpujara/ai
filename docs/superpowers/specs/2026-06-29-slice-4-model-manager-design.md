# Slice 4: Model Manager (multi-model, hardware-aware) — Design

**Date:** 2026-06-29
**Status:** Approved (design) — pending implementation plan
**Builds on:** Slice 3 (mountMcpServer + web_fetch). Repo: `inderjotpujara/ai`, branch `slice-4-model-manager`.

## 1. Vision

Make multi-model agents safe on local hardware. Today every agent uses one model
(`qwen3:8b`), so nothing is ever scheduled. This slice introduces a **Model
Manager** that loads the model an agent needs *when it runs*, evicts others to
stay within the GPU budget (~18 GB on the M4 Pro), and **never evicts the model
of an agent that is mid-delegation**. It is the foundation that dynamic
selection (Slice 5) and discovery (Slice 6) build on.

### The driving constraint
Nested delegation keeps **two models resident at once**: the orchestrator's
model stays loaded (paused, awaiting the sub-agent's result) *while* the
sub-agent's model runs. The manager must fit **pinned (orchestrator) + active
specialist** together, and must not unload the orchestrator mid-delegation.
Design response: the orchestrator runs a **small** model (`qwen3:4b`), pinned
resident; specialists use their own (possibly larger) models, loaded on demand.

## 2. Scope

### In scope (Slice 4)
- `listLoadedModels()` on the Ollama control client (`GET /api/ps`) — what is resident + its size.
- A footprint hint on `ModelDeclaration` so the manager can size a model before loading.
- `model-manager.ts`: `ensureReady(decl, { pinned })` — install→estimate→check budget vs resident→evict non-pinned LRU to fit→warm. `ResourceError` if impossible.
- `Agent` gains optional `modelDecl?: ModelDeclaration` (production agents set it; mock agents omit it → manager no-op).
- An `onBeforeDelegate(agent)` hook on the orchestrator, wired by the CLI to the manager (keeps `core/` decoupled from `resource/`).
- New `models/qwen-router.ts` (`qwen3:4b`) for the orchestrator; file_qa/web_fetch keep `qwen3:8b`.
- CLI warms the pinned router model at startup; specialists load on demand.
- Tests: deterministic unit tests of the eviction/pin/budget logic (mocked Ollama); opt-in live test with router+specialist co-resident.

### Out of scope — deferred (their own slices, see roadmap)
- **Slice 5 — dynamic selection** (role/requirements → registry → pick best model that fits).
- **Slice 6 — model discovery** (HF fetch latest, pull on demand, no hardcoded list).
- **Reclaim** (degrade → ask → kill apps) — a later escalation once memory pressure is real.
- Concurrent execution of multiple specialists (delegation stays sequential — one specialist active at a time).

## 3. Architecture

```
src/resource/
  ollama-control.ts  # MODIFY: add listLoadedModels() -> [{ name, sizeBytes }] (GET /api/ps)
  model-manager.ts   # NEW: createModelManager() -> { ensureReady }
  hardware.ts        # unchanged (machineBudgetBytes / fitsBudget)
  footprint.ts       # unchanged (estimateModelBytes)
src/core/
  types.ts           # MODIFY: ModelDeclaration gains footprint hint
  agent-def.ts       # MODIFY: Agent gains optional modelDecl
  orchestrator.ts    # MODIFY: createOrchestrator accepts optional onBeforeDelegate; runs it before each delegate
  delegate.ts        # MODIFY: asDelegateTool runs the before-delegate hook before runDefinedAgent
models/
  qwen-router.ts     # NEW: qwen3:4b declaration for the orchestrator (with footprint hint)
  qwen-fast.ts       # MODIFY: add the required `footprint` hint (≈8B, 0.56 B/weight)
agents/
  super.ts           # MODIFY: orchestrator uses qwen-router; pass modelDecl on each sub-agent
  file-qa.ts         # MODIFY: set modelDecl: qwenFast on the agent
  web-fetch.ts       # MODIFY: set modelDecl: qwenFast on the agent
src/cli/
  chat.ts            # MODIFY: build manager, warm+pin router, wire onBeforeDelegate
tests/
  resource/model-manager.test.ts          # NEW (mock)
  resource/ollama-control.test.ts          # MODIFY: add listLoadedModels test
  integration/model-manager.live.test.ts   # NEW (opt-in, auto-skip)
```

### 3.1 ModelDeclaration footprint hint — `src/core/types.ts`
```
type ModelDeclaration = {
  provider: ProviderKind;
  model: string;
  params: ModelParams;
  role: string;
  footprint: { approxParamsBillions: number; bytesPerWeight: number }; // NEW — for pre-load sizing
};
```
The manager computes bytes via `estimateModelBytes({ paramsBillions: footprint.approxParamsBillions, bytesPerWeight: footprint.bytesPerWeight, contextTokens: params.numCtx ?? 8192, kvBytesPerToken: 131072 })`.

### 3.2 `listLoadedModels` — `src/resource/ollama-control.ts`
```
type LoadedModel = { name: string; sizeBytes: number };
listLoadedModels(baseUrl?): Promise<LoadedModel[]>
// GET /api/ps -> { models: [{ name, size, ... }] } ; map name + size (bytes).
```

### 3.3 Model Manager — `src/resource/model-manager.ts`
```
type EnsureOpts = { pinned?: string[] };  // model names that must NOT be evicted
createModelManager(opts?: { baseUrl?: string; budgetBytes?: number }) -> {
  ensureReady(decl: ModelDeclaration, opts?: EnsureOpts): Promise<void>
}
```
`ensureReady` algorithm:
1. If `decl.model` not installed → `pullModel`.
2. `loaded = listLoadedModels()`. If `decl.model` already loaded → mark used, return (it's resident).
3. `needed = estimateModelBytes(decl)`; `budget = budgetBytes ?? machineBudgetBytes()`.
4. Compute resident bytes of models we'd keep: pinned models + `decl.model`. If `keptBytes + needed` (excluding any already counted) ≤ budget after keeping pinned, we can load without eviction.
5. While `pinnedResident + needed + otherResident > budget`: unload the **least-recently-used non-pinned** loaded model (never a pinned one; never `decl.model`). Track last-used timestamps in the manager.
6. If, with all non-pinned evicted, `pinnedResident + needed > budget` → throw `ResourceError` (the model cannot fit alongside pinned).
7. `warmModel(decl.model)`; stamp last-used.

The manager keeps an in-memory `Map<modelName, lastUsedTick>` for LRU. (A monotonic counter, not wall-clock, to stay deterministic/testable.)

### 3.4 Agent + hook wiring
- `Agent` gains `modelDecl?: ModelDeclaration`.
- `asDelegateTool(agent, onBeforeDelegate?)`: if `onBeforeDelegate` is provided, `await onBeforeDelegate(agent)` before `runDefinedAgent`. (Hook is optional → existing tests unaffected.)
- `createOrchestrator({ ..., onBeforeDelegate? })` threads the hook into each `asDelegateTool`.
- **CLI** builds the manager and passes `onBeforeDelegate: (agent) => agent.modelDecl ? manager.ensureReady(agent.modelDecl, { pinned: [routerDecl.model] }) : Promise.resolve()`.

## 4. Data flow
```
CLI startup: manager.ensureReady(router=qwen3:4b, {pinned:[qwen3:4b]}) -> warm (resident, pinned)
user task -> orchestrator(qwen3:4b) decides delegate_to_<X>
  -> onBeforeDelegate(X): manager.ensureReady(X.modelDecl, {pinned:[qwen3:4b]})
        - X.model resident? return
        - else fits with pinned? warm
        - else evict LRU non-pinned (never qwen3:4b) until fits -> warm  (ResourceError if impossible)
  -> sub-agent runs on X.model (qwen3:8b) ; qwen3:4b stays pinned
  -> answer bubbles up
```

## 5. Error handling
- `ResourceError` only when a model cannot fit even after evicting all non-pinned models (clear message: model + needed vs budget + pinned).
- The orchestrator's pinned model is never unloaded by `ensureReady`.
- Pull/warm/unload failures surface as `ProviderError` (existing).
- Manager is injected via the hook; `core/` does not import `resource/` (no layering violation).

## 6. Testing strategy
- **Unit/mock (always, no Ollama):** inject fakes for `listLoadedModels`/`pullModel`/`warmModel`/`unloadModel` (the manager takes these as deps, or `mock.module`). Cover:
  - already-loaded → no pull/warm/unload beyond a no-op.
  - not installed → pulls, then warms.
  - fits alongside pinned → warms, no eviction.
  - over budget → evicts the LRU **non-pinned** model(s), keeps pinned, then warms.
  - pinned never evicted (even if it's the LRU).
  - cannot fit with pinned → throws `ResourceError`, warms nothing.
- **ollama-control:** `listLoadedModels` parses `/api/ps` (mock fetch).
- **Opt-in live (`model-manager.live.test.ts`, auto-skip via `ollamaReady`):** ensure router (qwen3:4b) + a specialist (qwen3:8b); assert `/api/ps` shows BOTH resident and pinned router survived. (Needs qwen3:4b pulled.)
- `bun test` green without Ollama; `bun run typecheck` + `bun run lint` clean.

## 7. Definition of done
Agents can declare different models; the manager loads an agent's model when it runs, keeps the orchestrator's small model pinned-resident, evicts non-pinned models to stay within budget, and raises `ResourceError` when something cannot fit. The orchestrator runs on `qwen3:4b`; file_qa/web_fetch on `qwen3:8b`; co-residency verified by the live test. Unit suite green with no external deps; typecheck + lint clean.

## 8. Notes / future seams
- LRU uses a monotonic counter (testable); good enough for sequential delegation.
- `ensureReady`'s signature (decl + pinned) is exactly what Slice 5's selector will call after it picks a model, and what Slice 6's discovery will call after a pull — the manager is the shared sink.
- Reclaim (ask→kill) will extend step 6: instead of immediately throwing `ResourceError`, offer to free OS memory first.

**Model choice update (mid-2026 research, 2026-06-29):** the concrete model tags are **current-gen Qwen3.5** — orchestrator `qwen3.5:4b`, specialists `qwen3.5:9b` (this doc's earlier `qwen3:4b`/`qwen3:8b` mentions were the pre-research placeholders; "today every agent uses `qwen3:8b`" remains accurate for the pre-Slice-4 state). Use **standard GGUF tags, not `-mlx`** (Ollama's MLX backend needs >32 GB; this 24 GB box runs llama.cpp Metal). Build-time verify-and-fallback: if `qwen3.5:*` tags are missing or lack the `tools` capability (`ollama show`), fall back to `qwen3:4b`/`qwen3:8b` (proven, live-verified in Slices 1–3). `ornith:9b` (DeepReinforce, Jun 2026) is noted as a future *coding* sub-agent — its native Ollama tool-calling is unconfirmed, so it's not used on the router/general path. The manager is model-agnostic, so these names are swappable data, and Slice 6 (discovery) will keep them current automatically.
