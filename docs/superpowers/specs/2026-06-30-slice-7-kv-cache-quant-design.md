# Slice 7 — KV-Cache Quantization (dynamic, per-model, arch-derived) — design

**Date:** 2026-06-30
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 4 (footprint + dynamic context sizing), Slice 6 (multi-runtime; serve script; live `/api/show` probe)
**Feeds:** parallel fan-out (per-model KV headroom reservation), context compression (Headroom — separate slice)

---

## 1. Problem & goal

The Model Manager sizes context to fit a live RAM budget: `maxCtxByFit = floor((headroom − weights) / kvPerToken)`, with `kvPerToken` a **flat 131072** default (an f16 estimate). KV cache is a large, linear-in-context RAM cost — and Ollama/llama.cpp can **quantize** it (`OLLAMA_KV_CACHE_TYPE`, requires `OLLAMA_FLASH_ATTENTION=1`) to ~0.5× (`q8_0`) or ~0.25× (`q4_0`), so the same RAM buys ~2× context or a bigger model.

**Design principle — generalized, not model-specific.** The framework discovers and runs *any* model family (Qwen today is only the bootstrap; Gemma is already discoverable; new open models ship constantly). So KV decisions must be **derived from each model's own architecture, probed live** — never from "which family is it." Two facts from current (2026) research drive this:
- **One KV setting does not fit all models.** q8_0 is near-lossless for some architectures (e.g. Qwen high-GQA, KL ~0.02–0.04; Llama/Mistral tolerant) but meaningfully degrades others **even at q8_0** (Gemma dense KL ~0.108; **Gemma-MoE KL ~0.377**, collapsing to ~1.088 / ~68% top-1 at q4_0). The risk axis is **architecture — small `head_dim` (64) + MoE routing — not GQA** (high-GQA is in fact the *most* tolerant). q4_0's damage concentrates in **long-context recall + tool-calling** (our exact workload).
- **The KV *type* must be global on Ollama.** `OLLAMA_KV_CACHE_TYPE` is process-wide (the per-model Modelfile PR is unmerged); per-model *type* would need one runtime process per model (llama.cpp-server / vLLM / MLX) — deferred. There is also **no strictly-better shippable option**: asymmetric K=q8/V=q4 *fails on Apple Silicon Metal* and Ollama exposes no per-K/V control; eviction methods (SnapKV/H2O) aren't in Ollama. So a global default is correct, and **q8_0 is the ceiling of better-than-q4-and-shippable.**

So: **global KV type (q8_0 default), but per-model dynamic sizing + per-model arch-derived quant-risk awareness.**

### Locked decisions
1. **Single source of truth `AGENT_KV_CACHE_TYPE` env, default `q8_0`.** `serve.sh` reads it → exports `OLLAMA_KV_CACHE_TYPE` + `OLLAMA_FLASH_ATTENTION=1`; the CLI reads the same env for the multiplier. (FA is **not** auto-enabled on Apple Silicon, so setting it is mandatory or the cache type is silently ignored.)
2. **Per-model f16 KV/token is probed live, not hardcoded.** From the `/api/show` arch metadata: `kvF16PerToken = block_count × head_count_kv × (key_length + value_length) × 2 bytes`. Multiplied by the active type's multiplier. Falls back to `decl.footprint.kvBytesPerToken` then 131072. Memoized per model.
3. **Per-model quant-risk is derived from arch, generalized.** `head_dim (= key_length) ≤ 64` **or** `expert_count > 0` (MoE) ⇒ risky-under-quant. Drives an advisory/warning — **no model-family names in the logic**. Any model (current or future) is judged on its own architecture.
4. **q8_0 default / q4_0 opt-in.** Type is global; q4_0's caveat is "degrades long-context recall + tool-calling, and arch-risky models" (not "high-GQA").

---

## 2. Components

### 2.1 `src/resource/kv-cache.ts` (new — KV policy, single source of truth)
```ts
export enum KvCacheType { F16 = 'f16', Q8_0 = 'q8_0', Q4_0 = 'q4_0' }

/** RAM multiplier on the f16 KV baseline: f16→1.0, q8_0→0.5, q4_0→0.25. */
export function kvCacheMultiplier(type: KvCacheType): number;

/** Active type from AGENT_KV_CACHE_TYPE env; default q8_0; unrecognized → q8_0. */
export function activeKvCacheType(): KvCacheType;

/** GGUF attention dims needed to size + risk-assess KV (from /api/show). */
export type KvArch = {
  blockCount: number;        // n layers
  headCountKv: number;       // KV heads (GQA-aware; query heads don't count)
  keyLength: number;         // head_dim for K
  valueLength: number;       // head_dim for V
  expertCount: number;       // >0 ⇒ MoE
};

/** f16 KV bytes/token from real arch: blockCount × headCountKv × (keyLength+valueLength) × 2. */
export function f16KvBytesPerToken(arch: KvArch): number;

/** Effective KV bytes/token for sizing: per-model f16 baseline × active multiplier.
 *  Baseline precedence: probed arch → decl.footprint.kvBytesPerToken → 131072. */
export function effectiveKvBytesPerToken(f16Baseline: number): number; // × multiplier(activeType)

/** Generalized, arch-derived: risky to quantize? head_dim ≤ 64 OR MoE. No family names. */
export function isKvQuantRisky(arch: KvArch): boolean;
```

### 2.2 `src/resource/ollama-control.ts` — extend the `/api/show` probe
We already call `POST /api/show` for `context_length` (`getModelMaxContext`). Add a sibling that reads the KV arch fields from the same `model_info` block (keyed by `<arch>` prefix, e.g. `qwen3.*`, `gemma3.*`, `llama.*`):
```ts
export async function getModelKvArch(model: string, baseUrl?): Promise<KvArch | undefined>;
//   reads model_info["<arch>.block_count"], ["<arch>.attention.head_count_kv"],
//   ["<arch>.attention.key_length"], ["<arch>.attention.value_length"],
//   ["<arch>.expert_count"] (0 if absent). undefined if arch/fields missing.
```
Arch-agnostic: it resolves `<arch>` from `general.architecture` (same way `getModelMaxContext` already does) — works for any family. (Optionally fold both reads into one `/api/show` call to avoid a second round-trip; an optimization, not required.)

### 2.3 `src/resource/model-manager.ts` — dynamic per-model KV
- Add a memoized `kvF16PerTokenByModel` map (mirrors `maxCtxByModel`). On `ensureReady`, probe `getModelKvArch` once per model; compute `f16KvBytesPerToken(arch)`; fall back to `decl.footprint.kvBytesPerToken ?? 131072` if the probe fails.
- Resolve `kvPerToken = f16Baseline × kvCacheMultiplier(activeKvCacheType())` and use it in `minNeed` + `maxCtxByFit` (replacing the flat `?? DEFAULT_KV_PER_TOKEN`).
- Compute `isKvQuantRisky(arch)` (memoized). When the active type is quantized (≠ f16) **and** the model is risky, emit a one-time advisory via the existing `warn` dep: *"<model>: small head_dim/MoE arch may lose accuracy under <type> KV cache; consider AGENT_KV_CACHE_TYPE=f16 for it."* (Type is global, so this is advisory, not enforcement.)

### 2.4 `scripts/serve.sh`
```bash
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE="${AGENT_KV_CACHE_TYPE:-q8_0}"
echo "KV cache: $OLLAMA_KV_CACHE_TYPE (flash-attention on; required on Apple Silicon)"
if [ "$OLLAMA_KV_CACHE_TYPE" = "q4_0" ]; then
  echo "⚠ q4_0 KV degrades long-context recall + tool-calling, and arch-risky models (small head_dim / MoE). Prefer q8_0 unless verified." >&2
fi
```

### 2.5 Selection notice
Append the active KV type, and the risk advisory when applicable, e.g.:
`9.0B · weights ≈6.0GB + KV ≈1.1GB @ up to 16384 ctx = ≈7.1GB · KV q8_0` and, if risky, `⚠ arch-sensitive to KV quant`.

---

## 3. Data flow
```
bun run serve: AGENT_KV_CACHE_TYPE (default q8_0) → OLLAMA_KV_CACHE_TYPE + OLLAMA_FLASH_ATTENTION=1
ensureReady(decl):
  arch = getModelKvArch(model)            // live /api/show, any family; memoized
  f16Base = arch ? f16KvBytesPerToken(arch) : (decl.footprint.kvBytesPerToken ?? 131072)
  kvPerToken = f16Base × multiplier(activeKvCacheType())   // q8_0 → ×0.5
  minNeed / maxCtxByFit use kvPerToken  → accurate per-model fit + ~2× ctx under q8_0
  if quantized && isKvQuantRisky(arch): warn (advisory)
notice prints chosen ctx + active KV type (+ risk flag)
```

---

## 4. Error handling / safety
- `/api/show` probe failure → fall back to `decl.footprint.kvBytesPerToken ?? 131072` (never crash; same as today). Risk unknown → no advisory.
- Unrecognized `AGENT_KV_CACHE_TYPE` → q8_0.
- Raw Ollama (not via `serve.sh`) → server KV may be f16 while CLI assumes q8_0 → CLI would under-estimate KV. Mitigated by the project's mandated `bun run serve`; documented. (Future hardening: probe server type — §6.)
- `minNeed` only ever shrinks under quant, so fit is never made harder; eviction/pin logic unchanged.

---

## 5. Testing
- **Unit `tests/resource/kv-cache.test.ts`:** `kvCacheMultiplier` (1.0/0.5/0.25); `activeKvCacheType` env parse (unset→q8_0, q4_0 honored, garbage→q8_0, save/restore env); `f16KvBytesPerToken` from a sample `KvArch` (verify the `block×heads×(k+v)×2` math, incl. a high-GQA small-KV case vs a large-KV case to show many-fold spread); `isKvQuantRisky` true for head_dim 64 / MoE, false for head_dim 128 dense.
- **Unit (manager, mocked):** inject a `getModelKvArch` fake → assert `kvPerToken` = arch baseline × multiplier; with q8_0 a fixed budget yields ~2× `chosenCtx` vs f16 and a smaller `minNeed`; a risky-arch model under q8_0 triggers the `warn` advisory; probe-failure path falls back to 131072. Save/restore env.
- **Live (opt-in, auto-skip):** `bun run serve` sets the env; a chat run answers and the notice shows ctx + `KV q8_0`. (Ollama exposes no API to read back the active type, so the deterministic unit tests are the real proof.)

---

## 6. Future work (committed → ROADMAP)
- **Per-model KV *type* enforcement** — needs one runtime process per model (llama.cpp-server / vLLM / MLX `--kv-cache-bits`). Lets a Gemma-class model run at f16 while others use q8_0. Build when a real model in the fleet needs a different type than the global default.
- **Reserve-headroom-for-context / co-resident KV budgeting** — for parallel fan-out: reserve per-model KV headroom (now per-model-accurate) so co-resident models coexist.
- **Context compression (Headroom — headroomlabs-ai)** — separate slice; compresses *token count* (composes with KV-quant's *bytes/token*); mount via MCP; needs a quality spike on a local model first. See `reference-headroom-context-compression` memory.
- **Asymmetric K/V** — broken on Apple Silicon Metal + unexposed by Ollama; revisit only if both change.
- **Server KV-type probe** — confirm the server's actual type at runtime to harden the raw-Ollama case.

---

## 7. Out of scope for Slice 7
Per-model KV *type* enforcement (global on Ollama), context compression (separate slice), asymmetric K/V, parallel co-residency reservation — all §6. Note: nothing in this slice is model-family-specific; all KV behavior is derived from live per-model architecture.
