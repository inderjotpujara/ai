# Dynamic, Budget-Clamped Context Sizing — Design

**Date:** 2026-06-29
**Status:** approved (pending spec review)
**Builds on:** the live-memory-budget fix (branch `fix-live-memory-budget`) — this
change integrates into the `ensureReady` free-headroom loop introduced there.

## Problem

The model context window (`num_ctx`) is today both **static and disconnected**:

1. **Static** — `models/qwen-router.ts` and `models/qwen-fast.ts` hardcode
   `numCtx: 8192`. Nothing adjusts it at runtime.
2. **Disconnected** — `numCtx` is used *only* in the KV-cache term of the memory
   estimate (`declBytes`). It is never passed to Ollama. `createOllamaModel` drops
   `decl.params`, and `agent.ts` forwards only `temperature`. So Ollama loads every
   model at its **own default `num_ctx` (4096)**, not 8192.

Consequences: the context we budget for (8192) and the context Ollama actually runs
(4096) disagree, so the footprint estimate is wrong; and any task needing more than
4096 tokens is silently truncated despite the "8192" declaration.

This contradicts the project's hardware/context-aware north star: context is the
*other* lever on memory (KV cache grows linearly with `num_ctx`), so it should be
**sized to the live budget and actually applied**.

## Goal

Make context sizing **dynamic, hardware-aware, and wired through**:

- Choose `num_ctx` per delegation from the live free-RAM headroom (budget-clamped).
- Pass the chosen `num_ctx` to Ollama at **both** warm (load) and inference, from a
  **single source of truth**, so the runner reserves the right window and no reload
  is triggered.

Non-goal (deferred): input-/task-length-driven sizing. The chosen policy is
budget-clamped; input-awareness is a later refinement once token telemetry exists.

## Policy

Per `ensureReady` for a model:

```
weights      = paramsB × 1e9 × bytesPerWeight × RUNTIME_OVERHEAD     // no KV
kvPerToken   = decl.footprint.kvBytesPerToken ?? 131072
minNeed      = weights + kvPerToken × MIN_CTX                        // floor footprint
# (evict non-pinned → best-effort pinned until minNeed fits headroom, else ResourceError)
modelMax     = probeModelMaxContext(model) ?? decl.maxContext ?? desired   // LIVE, memoized
ceiling      = decl.maxContext ? min(modelMax, decl.maxContext) : modelMax  // optional cap
maxCtxByFit  = floor((headroom − weights) / kvPerToken)
chosenCtx    = clamp(desired, MIN_CTX, min(ceiling, maxCtxByFit))
chosenCtx    = roundDownTo(chosenCtx, 1024)                          // tidy multiple
```

Constants / declared / **detected** values:

- `MIN_CTX = 4096` (Ollama's own default; the minimum we will run a model at).
- `desired` = `decl.params.numCtx` — the role's preferred window: **router 8192,
  specialists 16384**. This is a *policy* choice (how much context the role wants),
  so it stays declared.
- `modelMax` = the model's **true context ceiling, detected live from Ollama** — NOT
  hardcoded. It is a model *fact*, varies per model, and must work for models we
  never declared (Slice 6 discovery). Probed via `POST /api/show` →
  `model_info["${arch}.context_length"]` where `arch = model_info["general.architecture"]`,
  memoized per model. **Verified live 2026-06-29:** qwen3.5:4b/9b report
  `general.architecture = "qwen35"` and `qwen35.context_length = 262144` (256K) — the
  arch key is `qwen35`, not `qwen3.5`, which is exactly why it must be read from Ollama
  rather than hand-declared. `decl.maxContext?` is an
  **optional override/cap only** (used to deliberately cap below the true max, or as a
  fallback if the probe fails). Same calculate-live-with-fallback principle as the
  memory budget.

Behavior: ample free RAM → `chosenCtx = min(desired, maxContext)`; tight free RAM →
`chosenCtx` shrinks toward `MIN_CTX`; if even `weights + kv(MIN_CTX)` cannot fit after
evicting everything evictable → `ResourceError` (the model can't run on this machine
right now).

## Architecture

The **Model Manager is the single source of truth** for `chosenCtx` — it already owns
the live headroom, so it owns the context decision. The value then flows to both the
warm call (inside the manager) and the inference call (via the delegation hook),
keeping `core/` decoupled from `resource/`.

```
ensureReady(decl, opts)
  ├─ split footprint: weights vs kvPerToken
  ├─ evict to fit minNeed (existing best-effort headroom loop)
  ├─ chosenCtx = clamp(...)            ← computed here
  ├─ warmModel(model, chosenCtx)       ← warm at chosenCtx
  └─ return chosenCtx

onBeforeDelegate(agent) → { numCtx: chosenCtx }     // hook returns the ctx
asDelegateTool / runDefinedAgent(agent, task, { numCtx })
  └─ providerOptions = { ollama: { options: { num_ctx: numCtx } } }
       → existing agent.ts plumbing → generateText → Ollama body options.num_ctx
```

`chat.ts`: the startup `ensureReady(qwenRouter, {pinned})` return value is the
orchestrator's own `num_ctx`, applied to the orchestrator run the same way.

## Components touched

| File | Change |
|---|---|
| `src/core/types.ts` | `ModelDeclaration.maxContext?: number` (**optional override/cap only**, not the source of truth); `Footprint.kvBytesPerToken?: number` |
| `src/resource/footprint.ts` | expose **weights** and **kv-per-token** separately (keep `estimateModelBytes` as `weights + kv(ctx)` for back-compat) |
| `src/resource/ollama-control.ts` | `warmModel(model, numCtx?)` → POST body adds `options:{ num_ctx }` only when `numCtx` is given (residency stays managed by explicit `unloadModel`; no `keep_alive` change); **new `getModelMaxContext(model)`** → `POST /api/show`, parse `model_info["${model_info['general.architecture']}.context_length"]` |
| `src/resource/model-manager.ts` | compute `chosenCtx` in the headroom loop using a **live, memoized** `modelMax` (probe `getModelMaxContext`, fall back to `decl.maxContext`/`desired` if it fails); `ensureReady` returns `number`; warm at `chosenCtx` |
| `src/core/delegate.ts` | `BeforeDelegate` returns `{ numCtx }`; build `providerOptions` and pass to `runDefinedAgent` |
| `src/core/orchestrator.ts` | thread the hook's `numCtx` through the delegate tools |
| `src/core/agent.ts` | (no change — already forwards `providerOptions`) |
| `agents/super.ts`, `agents/*.ts` | unchanged shells; rely on hook |
| `models/qwen-router.ts`, `models/qwen-fast.ts` | `numCtx` (desired) + new `maxContext` (+ optional `kvBytesPerToken`) |
| `src/cli/chat.ts` | use `ensureReady(router)` return as the orchestrator run's `num_ctx` |

## Data flow (inference)

1. Orchestrator decides to delegate to agent X.
2. `onBeforeDelegate(X)` → `manager.ensureReady(X.modelDecl, {pinned:[router]})` →
   warms X at `chosenCtx`, returns `chosenCtx`.
3. Delegate tool builds `providerOptions.ollama.options.num_ctx = chosenCtx` and runs
   X via `runDefinedAgent` → `generateText` → Ollama `/api/chat` with matching
   `num_ctx`. No runner reload (warm ctx == inference ctx).

## Error handling

- Cannot fit `weights + kv(MIN_CTX)` after evicting everything → `ResourceError`
  (same path/semantics as today's "nothing left to evict").
- `maxCtxByFit < MIN_CTX` is the same condition (can't even fit the floor) → throw.
- `warmModel`/inference failures propagate as today.

## Testing (TDD)

**Unit — `footprint.ts`:** weights and kv-per-token split correct; `estimateModelBytes`
unchanged for existing callers.

**Unit — `model-manager.ts`:**
- ample headroom → `chosenCtx == min(desired, maxContext)`.
- tight headroom → `chosenCtx` shrinks below desired, ≥ `MIN_CTX`, rounded to 1024.
- `chosenCtx` capped by `maxContext` even when headroom is huge.
- cannot fit `kv(MIN_CTX)` + weights → `ResourceError`, nothing warmed.
- `ensureReady` returns the chosen value; `warmModel` called with it.

**Unit — `ollama-control.ts`:** `warmModel(m, 8192)` POSTs body containing
`options.num_ctx === 8192`; `warmModel(m)` with no ctx omits `options`.
`getModelMaxContext` parses `model_info` (arch → `${arch}.context_length`) from a
mocked `/api/show` response; returns `undefined`/throws cleanly when the field/probe is
absent so the manager can fall back.

**Unit — `model-manager.ts` (live max):** with a fake `getModelMaxContext` returning a
small ceiling, `chosenCtx` is capped by the probed value even when headroom and desired
are larger; when the probe fails, it falls back to `decl.maxContext` then `desired`.

**Unit — `delegate.ts`:** hook returning `{ numCtx }` produces
`providerOptions.ollama.options.num_ctx` on the agent run.

**Live (opt-in, auto-skip):** warm + infer at the same chosen ctx against real Ollama;
assert the run answers and (best-effort) that no reload occurred / ctx took effect;
under simulated pressure the chosen ctx shrinks and the run still answers.

## Risks

- **kvBytesPerToken accuracy** — 131072 is a coarse constant; real KV/token depends on
  layers/heads/kv-quant. Mis-estimation only mis-sizes context (clamped by `maxContext`
  and `MIN_CTX`), never crashes. Per-model override added; precise per-arch computation
  deferred.
- **Reload on mismatch** — mitigated by sourcing warm and inference ctx from the one
  `chosenCtx`. A live test guards against regression.
- **`/api/show` probe failure** — if Ollama doesn't return a parseable
  `context_length` (older model, missing field), `getModelMaxContext` returns
  `undefined` and the manager falls back to `decl.maxContext` then `desired`. Probe
  result is memoized per model to avoid a `/api/show` call on every delegation.

## Forward-compatibility (dynamic models, Slice 6)

Because `modelMax` is detected from Ollama at runtime (not declared), a model pulled by
future **discovery** — one with no hand-written declaration — still gets a correct
context ceiling automatically. The only declared inputs are *policy* (`desired` per
role) and an *optional* cap (`decl.maxContext`); both have sane fallbacks, so a
discovered model with neither still runs (desired defaults applied, ceiling probed).
```
