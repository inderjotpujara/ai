# Slice 7 — KV-Cache Quantization (design)

**Date:** 2026-06-30
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 4 (Model Manager footprint + dynamic context sizing), Slice 6 (multi-runtime; serve script)
**Feeds:** parallel fan-out (per-model KV headroom reservation), context compression (Headroom — separate slice)

---

## 1. Problem & goal

The Model Manager sizes context to fit a live RAM budget: `maxCtxByFit = floor((headroom − weights) / kvPerToken)`, with `kvPerToken` defaulting to **131072** bytes/token (an f16 KV-cache estimate). KV cache is a large, linear-in-context RAM cost.

**Ollama/llama.cpp can quantize the KV cache** (`OLLAMA_KV_CACHE_TYPE`, requires `OLLAMA_FLASH_ATTENTION=1`), cutting `kvPerToken` to **~0.5×** (`q8_0`, near-lossless) or **~0.25×** (`q4_0`, riskier). Slice 7 wires this in so the same RAM buys **~2× context or a bigger model**, with negligible quality loss at the default.

This is a small, fully-local resource-manager enhancement. It is **orthogonal to** and **composes with** context *compression* (Headroom, a separate roadmapped slice): KV-quant shrinks bytes-per-token; compression shrinks token-count.

### Locked decisions (from brainstorming)
1. **Single source of truth: `AGENT_KV_CACHE_TYPE` env, default `q8_0`.** `serve.sh` reads it → exports `OLLAMA_KV_CACHE_TYPE=$AGENT_KV_CACHE_TYPE` + `OLLAMA_FLASH_ATTENTION=1` to the server; the CLI/manager reads the **same** env → `kvPerToken = base × multiplier(type)`. Both default to `q8_0`, so the project's mandated `bun run serve` flow keeps client and server aligned.
2. **q8_0 default (near-lossless); q4_0 opt-in.** Cache type is process-**global** (not per-model/per-delegation), and our bootstrap models are Qwen (**high-GQA**, more sensitive to aggressive KV quant per Ollama's FAQ), so `q4_0` is opt-in via the env with a serve-script warning.
3. **The multiplier flows through the existing footprint math** — one resolution point feeds both `minNeed` (smaller → bigger models fit) and `maxCtxByFit` (larger → more context). No new "reserve headroom" mechanism (see §6).

---

## 2. Components

### 2.1 `src/resource/kv-cache.ts` (new — single source of truth)
```ts
export enum KvCacheType { F16 = 'f16', Q8_0 = 'q8_0', Q4_0 = 'q4_0' }

/** RAM multiplier on the f16 KV baseline. */
export function kvCacheMultiplier(type: KvCacheType): number {
  // f16 → 1.0, q8_0 → 0.5, q4_0 → 0.25
}

/** Active type from AGENT_KV_CACHE_TYPE env; default q8_0; unrecognized → q8_0. */
export function activeKvCacheType(): KvCacheType;

/** Per-model f16 baseline (decl.footprint.kvBytesPerToken ?? 131072) × active multiplier. */
export function effectiveKvBytesPerToken(decl: ModelDeclaration): number;
```

### 2.2 `src/resource/model-manager.ts` (one change)
Replace the `kvPerToken` resolution in `ensureReady`:
```ts
// before:
const kvPerToken = decl.footprint.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN;
// after:
const kvPerToken = effectiveKvBytesPerToken(decl);
```
This single line scales **both** `minNeed = weights + kvCacheBytes(MIN_CTX, kvPerToken)` and `maxCtxByFit = floor((headroom − weights) / kvPerToken)` by the active type. All other manager logic (eviction, best-effort pin, rounding, ceiling) is unchanged. `DEFAULT_KV_PER_TOKEN` (131072) stays as the f16 baseline used inside `effectiveKvBytesPerToken`.

### 2.3 `scripts/serve.sh` (set the server env)
Before `exec ollama serve`, add:
```bash
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE="${AGENT_KV_CACHE_TYPE:-q8_0}"
echo "KV cache: $OLLAMA_KV_CACHE_TYPE (flash-attention on)"
if [ "$OLLAMA_KV_CACHE_TYPE" = "q4_0" ]; then
  echo "⚠ q4_0 KV cache is aggressive; high-GQA models (e.g. Qwen) are more sensitive — prefer q8_0 unless you've verified quality." >&2
fi
```
(`OLLAMA_KV_CACHE_TYPE` only takes effect with flash attention on — hence both are set.)

### 2.4 Selection notice (transparency)
Append the active KV type to the notice so the size line is self-explanatory, e.g.:
`9.0B · weights ≈6.0GB + KV ≈1.1GB @ up to 16384 ctx = ≈7.1GB · KV q8_0`.
(The KV GB already reflects the multiplier once §2.2 lands; this just labels the type. Thread `activeKvCacheType()` into the notice input or read it in the formatter.)

---

## 3. Data flow
```
bun run serve: AGENT_KV_CACHE_TYPE (default q8_0)
  → OLLAMA_KV_CACHE_TYPE + OLLAMA_FLASH_ATTENTION=1  (server quantizes KV)
chat/delegation: ensureReady
  → kvPerToken = (decl base 131072) × multiplier(activeKvCacheType())   // q8_0 → 65536
  → minNeed & maxCtxByFit use the smaller kvPerToken
  → ~2× chosenCtx for the same headroom (up to desired / model max), and/or a bigger model fits
notice prints the chosen ctx + active KV type
```

---

## 4. Error handling / safety
- Unrecognized `AGENT_KV_CACHE_TYPE` → fall back to `q8_0` (never crash); document valid values.
- If Ollama is started **without** `serve.sh` (raw/global Ollama), the server's KV is f16 but the CLI may assume q8_0 → the CLI would *under*-estimate KV (risk of over-fit). Mitigation: the project already mandates `bun run serve` (the "uniform process" rule) and warns when the project store isn't active; we document that KV-quant assumes the serve script. (A future hardening could probe/confirm the server type — deferred, see §6.)
- No change to the eviction/pin safety; `minNeed` only shrinks, so fit is never made harder.

---

## 5. Testing
- **Unit (`tests/resource/kv-cache.test.ts`):** `kvCacheMultiplier` per type (1.0/0.5/0.25); `activeKvCacheType` env parsing (unset → q8_0; `q4_0` honored; garbage → q8_0) with env save/restore; `effectiveKvBytesPerToken` = base × multiplier (and honors a per-model `kvBytesPerToken` base).
- **Unit (manager):** with `AGENT_KV_CACHE_TYPE=q8_0`, a fixed injected budget yields a `chosenCtx` ≈ **2×** the f16 result (and `minNeed` ≈ halved KV term) — deterministic, no Ollama. Save/restore the env around the test.
- **Live (opt-in, auto-skip):** `bun run serve` exports the two env vars; a chat run still answers and the notice shows the chosen ctx + `KV q8_0`. (Ollama exposes no clean API to read back the active cache type, so the deterministic unit test is the real proof; live is a smoke check.)

---

## 6. Future work (committed → ROADMAP)
- **Reserve-headroom-for-context / co-resident KV budgeting** — for **parallel fan-out**: when multiple models are resident, reserve per-model KV headroom so they coexist; KV-quant makes this ~2× cheaper. No value in today's sequential single-model flow (Ollama fixes `num_ctx` at warm; the manager already fills headroom with context each delegation).
- **Context compression (Headroom — headroomlabs-ai)** — a **separate slice**: compress tool outputs / files / history (fewer *tokens*) via the mount-an-MCP-server primitive; **composes with** KV-quant (cheaper *bytes per token*). Requires its own brainstorm + a **quality spike on the local qwen 9B** before committing (the project's $-token pitch is moot locally; benefit is context-fit + speed; its prose compressor is itself a model that competes for RAM). See `reference-headroom-context-compression` memory.
- **Asymmetric K/V** (`--cache-type-k` ≠ `--cache-type-v`) — not exposed by Ollama yet; revisit if/when it lands.
- **Server-type probe** — confirm the server's actual KV type at runtime instead of trusting the shared env, to harden the raw-Ollama case.

---

## 7. Out of scope for Slice 7
Per-model KV-type selection (cache type is global), context *compression* (separate Headroom slice), asymmetric K/V, and parallel co-residency headroom reservation — all in §6.
