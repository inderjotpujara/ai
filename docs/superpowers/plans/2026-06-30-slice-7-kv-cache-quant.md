# Slice 7 — KV-Cache Quantization (dynamic, per-model, arch-derived) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire KV-cache quantization (global `q8_0` default via Ollama) into the resource manager, with **per-model, architecture-derived** KV sizing + a generalized quant-risk advisory — all probed live, no model-family hardcoding.

**Architecture:** A new `kv-cache.ts` policy module (type multipliers + env + arch-based f16 sizing + risk). A live `/api/show` arch probe (`getModelKvArch`) added to the `RuntimeControl` port. The manager resolves `kvPerToken = perModelF16Baseline × multiplier(activeType)` and emits a generalized advisory when a quantized type runs an arch-risky model. `serve.sh` sets the server env; the selection notice labels the active type.

**Tech Stack:** TypeScript + Bun + Vercel AI SDK 6, Ollama HTTP (`/api/show`), `bun:test`, Biome.

## Global Constraints

- Use **`bun`**, never npm. Typecheck `bun run typecheck`; tests `bun test`; lint `bun run lint` (must end 0 warnings; the lone pre-existing biome.json deprecation *info* is acceptable).
- `type` over `interface`; **string `enum`** for finite sets; early returns; `.ts` import extensions; small focused files; notices/diagnostics → `console.error`.
- **Generalized, not model-specific:** no branching on model family/name anywhere. All KV behavior derives from live per-model architecture. (Qwen is only the current bootstrap.)
- KV cache **type is global** on Ollama (`OLLAMA_KV_CACHE_TYPE`, requires `OLLAMA_FLASH_ATTENTION=1`, which is **not** auto-enabled on Apple Silicon). Single source of truth: `AGENT_KV_CACHE_TYPE` env, **default `q8_0`**; `serve.sh` and the CLI both read it.
- Multipliers on the f16 KV baseline: `f16 → 1.0`, `q8_0 → 0.5`, `q4_0 → 0.25`.
- Per-model f16 KV/token = `block_count × head_count_kv × (key_length + value_length) × 2` (from `/api/show`); fallback `decl.footprint.kvBytesPerToken ?? 131072`.
- Quant-risk (arch-derived, generalized): `key_length ≤ 64` OR `expert_count > 0` (MoE).
- Conventional commits `type(scope): summary`; commit after each task's tests pass.

**Shared interfaces (defined in Task 1/2; later tasks rely on these names):**
```ts
// src/resource/kv-cache.ts
export enum KvCacheType { F16='f16', Q8_0='q8_0', Q4_0='q4_0' }
export type KvArch = { blockCount: number; headCountKv: number; keyLength: number; valueLength: number; expertCount: number };
export function kvCacheMultiplier(t: KvCacheType): number;
export function activeKvCacheType(): KvCacheType;                 // reads AGENT_KV_CACHE_TYPE, default q8_0
export function f16KvBytesPerToken(a: KvArch): number;
export function effectiveKvBytesPerToken(f16Baseline: number): number;  // f16Baseline × multiplier(activeKvCacheType())
export function isKvQuantRisky(a: KvArch): boolean;
// src/runtime/runtime.ts (RuntimeControl gains)
getModelKvArch(model: string): Promise<KvArch | undefined>;
```

---

### Task 1: `kv-cache.ts` — KV policy module (pure)

**Files:**
- Create: `src/resource/kv-cache.ts`
- Test: `tests/resource/kv-cache.test.ts`

**Interfaces:**
- Produces: `KvCacheType`, `KvArch`, `kvCacheMultiplier`, `activeKvCacheType`, `f16KvBytesPerToken`, `effectiveKvBytesPerToken`, `isKvQuantRisky` (see Global Constraints).

- [ ] **Step 1: Write the failing test** — `tests/resource/kv-cache.test.ts`
```ts
import { afterEach, expect, test } from 'bun:test';
import {
  type KvArch, KvCacheType, activeKvCacheType, effectiveKvBytesPerToken,
  f16KvBytesPerToken, isKvQuantRisky, kvCacheMultiplier,
} from '../../src/resource/kv-cache.ts';

afterEach(() => { delete process.env.AGENT_KV_CACHE_TYPE; });

test('multipliers', () => {
  expect(kvCacheMultiplier(KvCacheType.F16)).toBe(1.0);
  expect(kvCacheMultiplier(KvCacheType.Q8_0)).toBe(0.5);
  expect(kvCacheMultiplier(KvCacheType.Q4_0)).toBe(0.25);
});
test('activeKvCacheType: default q8_0, honors valid, garbage→q8_0', () => {
  expect(activeKvCacheType()).toBe(KvCacheType.Q8_0);
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
  expect(activeKvCacheType()).toBe(KvCacheType.F16);
  process.env.AGENT_KV_CACHE_TYPE = 'nonsense';
  expect(activeKvCacheType()).toBe(KvCacheType.Q8_0);
});
test('f16KvBytesPerToken from arch; high-GQA is many-fold smaller', () => {
  const bigKv: KvArch = { blockCount: 32, headCountKv: 32, keyLength: 128, valueLength: 128, expertCount: 0 };
  const gqaKv: KvArch = { blockCount: 32, headCountKv: 8, keyLength: 128, valueLength: 128, expertCount: 0 };
  expect(f16KvBytesPerToken(bigKv)).toBe(32 * 32 * 256 * 2);
  expect(f16KvBytesPerToken(gqaKv)).toBe(32 * 8 * 256 * 2);
  expect(f16KvBytesPerToken(bigKv) / f16KvBytesPerToken(gqaKv)).toBe(4); // many-fold spread
});
test('effectiveKvBytesPerToken applies active multiplier', () => {
  process.env.AGENT_KV_CACHE_TYPE = 'q8_0';
  expect(effectiveKvBytesPerToken(131072)).toBe(65536);
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
  expect(effectiveKvBytesPerToken(131072)).toBe(131072);
});
test('isKvQuantRisky: arch-derived, no family names', () => {
  expect(isKvQuantRisky({ blockCount: 32, headCountKv: 8, keyLength: 64, valueLength: 64, expertCount: 0 })).toBe(true); // small head_dim
  expect(isKvQuantRisky({ blockCount: 32, headCountKv: 8, keyLength: 128, valueLength: 128, expertCount: 8 })).toBe(true); // MoE
  expect(isKvQuantRisky({ blockCount: 32, headCountKv: 8, keyLength: 128, valueLength: 128, expertCount: 0 })).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/resource/kv-cache.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/resource/kv-cache.ts`
```ts
/** KV-cache quantization policy. Type is global (Ollama); sizing+risk are per-model, arch-derived. */
export enum KvCacheType {
  F16 = 'f16',
  Q8_0 = 'q8_0',
  Q4_0 = 'q4_0',
}

/** GGUF attention dims (from /api/show) needed to size + risk-assess the KV cache. */
export type KvArch = {
  blockCount: number;
  headCountKv: number;
  keyLength: number;
  valueLength: number;
  expertCount: number;
};

const MULTIPLIER: Record<KvCacheType, number> = {
  [KvCacheType.F16]: 1.0,
  [KvCacheType.Q8_0]: 0.5,
  [KvCacheType.Q4_0]: 0.25,
};

/** RAM multiplier on the f16 KV baseline for a cache type. */
export function kvCacheMultiplier(type: KvCacheType): number {
  return MULTIPLIER[type];
}

/** Active type from AGENT_KV_CACHE_TYPE; default q8_0; unrecognized → q8_0. */
export function activeKvCacheType(): KvCacheType {
  const raw = (process.env.AGENT_KV_CACHE_TYPE ?? '').toLowerCase();
  return (Object.values(KvCacheType) as string[]).includes(raw)
    ? (raw as KvCacheType)
    : KvCacheType.Q8_0;
}

/** f16 KV bytes/token from real arch: layers × kv-heads × (k+v head dims) × 2 bytes. */
export function f16KvBytesPerToken(a: KvArch): number {
  return a.blockCount * a.headCountKv * (a.keyLength + a.valueLength) * 2;
}

/** Effective KV bytes/token for sizing: f16 baseline × the active type's multiplier. */
export function effectiveKvBytesPerToken(f16Baseline: number): number {
  return Math.round(f16Baseline * kvCacheMultiplier(activeKvCacheType()));
}

/** Generalized, arch-derived risk: small head_dim or MoE routing degrade more under KV quant. */
export function isKvQuantRisky(a: KvArch): boolean {
  return a.keyLength <= 64 || a.expertCount > 0;
}
```

- [ ] **Step 4: Run** — `bun test tests/resource/kv-cache.test.ts` → PASS (5). `bun run typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/resource/kv-cache.ts tests/resource/kv-cache.test.ts
git commit -m "feat(resource): KV-cache policy module (type multipliers + arch f16 sizing + risk)"
```

---

### Task 2: `getModelKvArch` probe + `RuntimeControl` extension

**Files:**
- Modify: `src/resource/ollama-control.ts`
- Modify: `src/runtime/runtime.ts`
- Modify: `src/runtime/ollama.ts`
- Modify: `src/runtime/mlx-server.ts`
- Test: `tests/resource/ollama-control-kvarch.test.ts`

**Interfaces:**
- Consumes: `KvArch` (Task 1).
- Produces: `getModelKvArch(model, baseUrl?): Promise<KvArch | undefined>` in ollama-control; `RuntimeControl.getModelKvArch`; Ollama runtime wires it; MLX runtime returns `undefined`.

- [ ] **Step 1: Write the failing test** — `tests/resource/ollama-control-kvarch.test.ts`
```ts
import { afterEach, expect, test } from 'bun:test';
import { getModelKvArch } from '../../src/resource/ollama-control.ts';

const orig = globalThis.fetch;
afterEach(() => { globalThis.fetch = orig; });

test('parses KV arch from /api/show model_info', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ model_info: {
      'general.architecture': 'qwen3',
      'qwen3.block_count': 36,
      'qwen3.attention.head_count_kv': 8,
      'qwen3.attention.key_length': 128,
      'qwen3.attention.value_length': 128,
    } }), { status: 200 })) as unknown as typeof fetch;
  const arch = await getModelKvArch('qwen3.5:9b');
  expect(arch).toEqual({ blockCount: 36, headCountKv: 8, keyLength: 128, valueLength: 128, expertCount: 0 });
});
test('undefined when required fields missing', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ model_info: { 'general.architecture': 'x' } }), { status: 200 })) as unknown as typeof fetch;
  expect(await getModelKvArch('x')).toBeUndefined();
});
test('undefined (no throw) on fetch failure', async () => {
  globalThis.fetch = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  expect(await getModelKvArch('x')).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/resource/ollama-control-kvarch.test.ts` → FAIL.

- [ ] **Step 3: Implement the probe** — append to `src/resource/ollama-control.ts`
Add the import at the top (with the other type imports):
```ts
import type { KvArch } from './kv-cache.ts';
```
Add the function (mirrors `getModelMaxContext`'s `/api/show` + `<arch>` resolution; returns undefined on any failure so it never breaks the caller):
```ts
/** The model's KV attention dims, read live from POST /api/show. Undefined if unavailable. */
export async function getModelKvArch(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<KvArch | undefined> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    });
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;
  const data = (await res.json()) as { model_info?: Record<string, unknown> };
  const info = data.model_info ?? {};
  const arch = info['general.architecture'];
  if (typeof arch !== 'string') return undefined;
  const num = (key: string): number | undefined => {
    const v = info[`${arch}.${key}`];
    return typeof v === 'number' ? v : undefined;
  };
  const blockCount = num('block_count');
  const headCountKv = num('attention.head_count_kv');
  const keyLength = num('attention.key_length');
  const valueLength = num('attention.value_length');
  if (
    blockCount === undefined || headCountKv === undefined ||
    keyLength === undefined || valueLength === undefined
  ) {
    return undefined;
  }
  return { blockCount, headCountKv, keyLength, valueLength, expertCount: num('expert_count') ?? 0 };
}
```

- [ ] **Step 4: Extend the port + runtimes**
`src/runtime/runtime.ts` — add to `RuntimeControl` (and import `KvArch`):
```ts
import type { KvArch } from '../resource/kv-cache.ts';
// ...inside RuntimeControl:
  getModelKvArch(model: string): Promise<KvArch | undefined>;
```
`src/runtime/ollama.ts` — import `getModelKvArch` and add to `control`:
```ts
import { /* existing… */ getModelKvArch } from '../resource/ollama-control.ts';
// ...inside control:
  getModelKvArch: (m) => getModelKvArch(m),
```
`src/runtime/mlx-server.ts` — add to `control` (no /api/show on an OpenAI server):
```ts
  getModelKvArch: async () => undefined,
```

- [ ] **Step 5: Run** — `bun test tests/resource/ollama-control-kvarch.test.ts` → PASS (3). `bun test tests/runtime` → existing runtime tests still pass. `bun run typecheck` → clean.

- [ ] **Step 6: Commit**
```bash
git add src/resource/ollama-control.ts src/runtime/runtime.ts src/runtime/ollama.ts src/runtime/mlx-server.ts tests/resource/ollama-control-kvarch.test.ts
git commit -m "feat(runtime): live /api/show KV-arch probe on the RuntimeControl port"
```

---

### Task 3: Manager — per-model dynamic KV sizing + risk advisory

**Files:**
- Modify: `src/resource/model-manager.ts`
- Modify: `tests/resource/model-manager.test.ts`
- Test: `tests/resource/model-manager-kv.test.ts`

**Interfaces:**
- Consumes: `activeKvCacheType`, `effectiveKvBytesPerToken`, `f16KvBytesPerToken`, `isKvQuantRisky`, `KvCacheType` (Task 1); `RuntimeControl.getModelKvArch` (Task 2).
- Produces: `kvPerToken` resolved per-model (arch f16 baseline × active multiplier); a one-time arch-risk advisory via `warn`.

- [ ] **Step 1: Write the failing test** — `tests/resource/model-manager-kv.test.ts`
```ts
import { afterEach, expect, mock, test } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import type { ModelDeclaration } from '../../src/core/types.ts';
import { createModelManager, MIN_CTX } from '../../src/resource/model-manager.ts';
import type { KvArch, RuntimeControl } from '../../src/runtime/runtime.ts';

afterEach(() => { delete process.env.AGENT_KV_CACHE_TYPE; });

const arch: KvArch = { blockCount: 32, headCountKv: 8, keyLength: 128, valueLength: 128, expertCount: 0 };
function control(over: Partial<RuntimeControl> = {}): RuntimeControl {
  return {
    isInstalled: mock(async () => true),
    pull: mock(async () => {}),
    warm: mock(async () => {}),
    unload: mock(async () => {}),
    listLoaded: mock(async () => [] as { name: string; sizeBytes: number }[]),
    getModelMax: mock(async () => 262144),
    getModelKvArch: mock(async () => arch),
    ...over,
  };
}
function decl(numCtx: number): ModelDeclaration {
  return { provider: ProviderKind.Ollama, model: 'm', params: { numCtx }, role: 't',
    footprint: { approxParamsBillions: 1, bytesPerWeight: 0 } }; // weights 0 → all headroom is KV
}

test('q8_0 doubles chosenCtx vs f16 for the same budget (per-model arch baseline)', async () => {
  const c = control();
  const f16KvPerTok = arch.blockCount * arch.headCountKv * (arch.keyLength + arch.valueLength) * 2; // 32*8*256*2
  const budget = f16KvPerTok * 8192; // exactly 8192 tokens at f16
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
  const ctxF16 = await createModelManager({ budgetBytes: budget, warn: () => {}, controlFor: () => c })
    .ensureReady(decl(1_000_000));
  process.env.AGENT_KV_CACHE_TYPE = 'q8_0';
  const ctxQ8 = await createModelManager({ budgetBytes: budget, warn: () => {}, controlFor: () => c })
    .ensureReady(decl(1_000_000));
  expect(ctxF16).toBe(8192);
  expect(ctxQ8).toBe(16384); // ~2× under q8_0
});

test('arch-risky model under a quantized type triggers a one-time advisory', async () => {
  process.env.AGENT_KV_CACHE_TYPE = 'q8_0';
  const warn = mock((_: string) => {});
  const c = control({ getModelKvArch: mock(async () => ({ ...arch, keyLength: 64, valueLength: 64 })) }); // small head_dim
  await createModelManager({ budgetBytes: 100e9, warn, controlFor: () => c }).ensureReady(decl(8192));
  expect(warn).toHaveBeenCalled();
  expect((warn.mock.calls[0]?.[0] ?? '')).toContain('KV');
});

test('probe failure falls back to the 131072 f16 baseline (no throw)', async () => {
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
  const c = control({ getModelKvArch: mock(async () => undefined) });
  const budget = 131072 * 4096; // exactly MIN_CTX at the default baseline
  const ctx = await createModelManager({ budgetBytes: budget, warn: () => {}, controlFor: () => c }).ensureReady(decl(1_000_000));
  expect(ctx).toBe(MIN_CTX);
});
```

- [ ] **Step 2: Pin existing manager tests to f16** — in `tests/resource/model-manager.test.ts`, the existing assertions assume `kvPerToken = 131072` (f16). Add at the top of that file so the active type doesn't change their math:
```ts
import { afterAll, beforeAll } from 'bun:test';
let __prevKv: string | undefined;
beforeAll(() => { __prevKv = process.env.AGENT_KV_CACHE_TYPE; process.env.AGENT_KV_CACHE_TYPE = 'f16'; });
afterAll(() => { if (__prevKv === undefined) delete process.env.AGENT_KV_CACHE_TYPE; else process.env.AGENT_KV_CACHE_TYPE = __prevKv; });
```
Also extend that file's `fakeControl()` to include `getModelKvArch: mock(async () => undefined)` (so it falls back to the decl/default baseline — preserving the existing f16 numbers).

- [ ] **Step 3: Run to verify fail** — `bun test tests/resource/model-manager-kv.test.ts` → FAIL (manager ignores arch/type). `bun test tests/resource/model-manager.test.ts` → FAIL until the `getModelKvArch` is added to its fakeControl (Step 2).

- [ ] **Step 4: Implement** — `src/resource/model-manager.ts`
Add imports:
```ts
import {
  activeKvCacheType, effectiveKvBytesPerToken, f16KvBytesPerToken, isKvQuantRisky, KvCacheType,
} from './kv-cache.ts';
```
Add a memo + warned set alongside the others (after `runtimeByModel`):
```ts
  const kvF16ByModel = new Map<string, number>();
  const kvRiskWarned = new Set<string>();
```
Add a helper (after `modelMaxFor`):
```ts
  async function kvF16For(
    c: RuntimeControl,
    model: string,
    decl: ModelDeclaration,
  ): Promise<number> {
    const cached = kvF16ByModel.get(model);
    if (cached !== undefined) return cached;
    let arch: Awaited<ReturnType<RuntimeControl['getModelKvArch']>>;
    try {
      arch = await c.getModelKvArch(model);
    } catch {
      arch = undefined;
    }
    if (arch) {
      // generalized, arch-derived risk advisory (type is global, so this is informational)
      const type = activeKvCacheType();
      if (type !== KvCacheType.F16 && isKvQuantRisky(arch) && !kvRiskWarned.has(model)) {
        kvRiskWarned.add(model);
        d.warn(
          `[model-manager] ${model}: arch (small head_dim / MoE) may lose accuracy under ${type} KV cache; set AGENT_KV_CACHE_TYPE=f16 if quality matters for it.`,
        );
      }
    }
    const f16 = arch ? f16KvBytesPerToken(arch) : (decl.footprint.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN);
    kvF16ByModel.set(model, f16);
    return f16;
  }
```
Replace the `kvPerToken` line (currently line 84) with the per-model effective value:
```ts
    const f16Base = await kvF16For(c, target, decl);
    const kvPerToken = effectiveKvBytesPerToken(f16Base);
```
(Leave `minNeed`, the eviction loop, and `maxCtxByFit` exactly as-is — they already use `kvPerToken`.)

- [ ] **Step 5: Run** — `bun test tests/resource/model-manager-kv.test.ts` → PASS (3). `bun test tests/resource` → existing manager tests PASS (pinned to f16). `bun run typecheck` → clean.

- [ ] **Step 6: Commit**
```bash
git add src/resource/model-manager.ts tests/resource/model-manager.test.ts tests/resource/model-manager-kv.test.ts
git commit -m "feat(resource): per-model arch-derived KV sizing + generalized quant-risk advisory"
```

---

### Task 4: `serve.sh` env + selection-notice KV label

**Files:**
- Modify: `scripts/serve.sh`
- Modify: `src/cli/selection-notice.ts`
- Test: `tests/cli/selection-notice.test.ts`

**Interfaces:**
- Consumes: `activeKvCacheType`, `effectiveKvBytesPerToken`, `KvCacheType` (Task 1).
- Produces: serve script sets the two env vars; notice appends `· KV <type>` and reflects the multiplier in the KV GB.

- [ ] **Step 1: Write the failing test** — extend `tests/cli/selection-notice.test.ts` (add at the end):
```ts
import { afterEach } from 'bun:test';
afterEach(() => { delete process.env.AGENT_KV_CACHE_TYPE; });

test('notice labels the active KV cache type', () => {
  process.env.AGENT_KV_CACHE_TYPE = 'q8_0';
  const s = formatSelectionNotice({ decl, numCtx: 16384, budgetBytes: 12.3e9, installed: true });
  expect(s).toContain('KV q8_0');
});
```
(`decl` already exists at the top of that test file.)

- [ ] **Step 2: Run to verify fail** — `bun test tests/cli/selection-notice.test.ts` → FAIL (no "KV q8_0").

- [ ] **Step 3: Implement notice** — `src/cli/selection-notice.ts`
Add import + use the effective (multiplier-aware) KV in the size line and append the type label:
```ts
import { activeKvCacheType, effectiveKvBytesPerToken } from '../resource/kv-cache.ts';
```
Change the KV computation + the second line:
```ts
  const kv = kvCacheBytes(i.numCtx, effectiveKvBytesPerToken(f.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN));
  // ...
    `  ${f.approxParamsBillions.toFixed(1)}B · weights ≈${gb(w)}GB + KV ≈${gb(kv)}GB @ up to ${i.numCtx} ctx = ≈${gb(w + kv)}GB · KV ${activeKvCacheType()}`,
```
(The notice stays an approximation — it uses the decl/default f16 baseline, not the live arch probe — but now reflects the active type's multiplier + labels it. The manager's internal math is the accurate one.)

- [ ] **Step 4: Implement serve env** — `scripts/serve.sh`, insert before `exec ollama serve`:
```bash
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE="${AGENT_KV_CACHE_TYPE:-q8_0}"
echo "KV cache: $OLLAMA_KV_CACHE_TYPE (flash-attention on; required on Apple Silicon)"
if [ "$OLLAMA_KV_CACHE_TYPE" = "q4_0" ]; then
  echo "⚠ q4_0 KV degrades long-context recall + tool-calling, and arch-risky models (small head_dim / MoE). Prefer q8_0 unless verified." >&2
fi
```

- [ ] **Step 5: Run** — `bun test tests/cli/selection-notice.test.ts` → PASS. `bun run typecheck` → clean. `bash -n scripts/serve.sh` → no syntax error.

- [ ] **Step 6: Commit**
```bash
git add scripts/serve.sh src/cli/selection-notice.ts tests/cli/selection-notice.test.ts
git commit -m "feat(cli): serve sets KV-cache env; selection notice labels active KV type"
```

---

### Task 5: Docs + live smoke + final gate

**Files:**
- Modify: `README.md`, `docs/architecture.md`, `docs/ROADMAP.md`
- Test: `tests/integration/kv-cache.live.test.ts`

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Live smoke test** — `tests/integration/kv-cache.live.test.ts`
```ts
import { describe, expect, test } from 'bun:test';
import { warmModel, getModelKvArch, unloadModel } from '../../src/resource/ollama-control.ts';
import qwenFast from '../../models/qwen-fast.ts';
import { ollamaReady } from './ollama-available.ts';
import { f16KvBytesPerToken } from '../../src/resource/kv-cache.ts';

const ready = await ollamaReady(qwenFast.model);
describe.skipIf(!ready)('live KV arch probe', () => {
  test('reads real KV arch and computes a positive f16 baseline', async () => {
    const arch = await getModelKvArch(qwenFast.model);
    expect(arch).toBeDefined();
    if (arch) expect(f16KvBytesPerToken(arch)).toBeGreaterThan(0);
  }, 30_000);
});
```

- [ ] **Step 2: Run** — `bun test tests/integration/kv-cache.live.test.ts` → SKIP if Ollama down, PASS if up (arch probed). Then `bun test` → full suite green.

- [ ] **Step 3: README** — add to the resource/how-it-works section:
> **KV-cache quantization (Slice 7).** Start with `bun run serve` (sets `OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE`, default `q8_0` — flash attention is *required* and not auto-enabled on Apple Silicon). KV cache type is **global** (Ollama limitation), but the manager sizes context **per-model from each model's live architecture** (`/api/show`), so q8_0 yields ~2× context (near-lossless on tolerant architectures) and a generalized advisory warns when an *arch-risky* model (small head_dim / MoE) runs under a quantized cache. Override with `AGENT_KV_CACHE_TYPE=f16|q8_0|q4_0`.

- [ ] **Step 4: architecture.md** — add a "KV-cache quantization (Slice 7)" subsection in the resource model: global type via `AGENT_KV_CACHE_TYPE`/serve.sh; per-model f16 KV/token from `/api/show` arch (`block_count × head_count_kv × (key+value_length) × 2`) × multiplier; arch-derived risk (head_dim ≤ 64 / MoE); note nothing is model-family-specific.

- [ ] **Step 5: ROADMAP** — move Slice 7 to Shipped; record committed follow-ons: **per-model KV *type* enforcement** (needs per-process runtime: llama.cpp-server/vLLM/MLX), **reserve-headroom/co-resident KV budgeting** (parallel fan-out), **context compression (Headroom)** as a separate composed slice, asymmetric K/V (broken on Metal), server KV-type probe. Reference spec §6.

- [ ] **Step 6: Final gate** — `bun run typecheck && bun run lint && bun test` → clean / 0 warnings / green (live pass-or-skip). Commit:
```bash
git add tests/integration/kv-cache.live.test.ts README.md docs/architecture.md docs/ROADMAP.md
git commit -m "test(resource): live KV-arch probe + Slice 7 docs"
```

---

## Final review (whole-branch)
- [ ] `bun run typecheck` · `bun run lint` · `bun test` (note counts).
- [ ] Dispatch a code-review subagent (correctness, generalization/no-family-hardcoding, offline-safety of the probe, existing-manager-test regression). Apply verified findings; triage minors.

## Self-review (plan vs spec)
- §1.1 single env source of truth → Task 1 (`activeKvCacheType`) + Task 4 (serve.sh). ✓
- §1.2 per-model f16 from /api/show → Task 2 (probe) + Task 3 (use). ✓
- §1.3 arch-derived generalized risk → Task 1 (`isKvQuantRisky`) + Task 3 (advisory). ✓
- §1.4 q8_0 default / q4_0 opt-in + reworded caveat → Task 1 default + Task 4 serve warning. ✓
- §2.x components → Tasks 1–4; §4 fallback/no-crash → Task 2 (undefined-on-fail) + Task 3 (fallback test); §5 testing → every task + Task 5 live. ✓
- §6 future work → ROADMAP at Task 5. ✓
- **Placeholder scan:** complete code in every step; no TBD. ✓
- **Type consistency:** `KvArch`, `activeKvCacheType`, `effectiveKvBytesPerToken`, `f16KvBytesPerToken`, `isKvQuantRisky`, `getModelKvArch` consistent across Tasks 1–4; manager `kvPerToken` uses the new resolver; existing manager tests pinned to f16 to avoid a multiplier-induced regression. ✓
- **Generalization:** no model-family branching anywhere; risk + sizing are arch-derived. ✓
