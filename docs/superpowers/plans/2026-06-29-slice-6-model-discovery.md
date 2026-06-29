# Slice 6 — Model Discovery + Multi-Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover the latest local models at runtime per host (offline-first cached catalog + `discover` command), running text/tool agents on two runtimes (Ollama-GGUF and a local MLX server), on a four-axis extensible taxonomy that has typed slots for vision/audio/video/uncensored.

**Architecture:** A `Runtime` port (Ollama + MLX-server) makes the Model Manager runtime-agnostic. A `CatalogSource` port (HF-GGUF + HF-MLX) produces `Candidate`s from Hugging Face; a `discover` pipeline filters/ranks/caches them and pre-pulls the top fitting model per runtime. Normal chat runs read an offline merge (`bootstrap ∪ installed ∪ cached catalog`) and feed the existing Slice-5 selector unchanged.

**Tech Stack:** TypeScript + Bun + Vercel AI SDK 6 (`ai`, `ollama-ai-provider-v2`, `@ai-sdk/openai-compatible` for the MLX server), Ollama + Hugging Face HTTP APIs, `bun:test`, Biome.

## Global Constraints

- Use **`bun`**, never npm. Typecheck `bun run typecheck`; tests `bun test`; lint `bun run lint` (Biome `biome check .`).
- `type` over `interface`; **string `enum`** for finite named sets; discriminated unions stay `type`; early returns; small focused files; descriptive names.
- Intra-repo imports use the **`.ts`** extension. Model declarations live at repo-root `models/`; runtime code under `src/runtime/`; discovery under `src/discovery/`.
- Diagnostics/notices → **`console.error`**; only the final user answer → `console.log`. No leftover `console.log`.
- Conventional commits `type(scope): summary`; commit after each task's tests pass.
- Verified pins (do not bump): `ai@^6`, `ollama-ai-provider-v2@^3`, `@ai-sdk/mcp@^1`, `@modelcontextprotocol/sdk@^1`, `zod@^4`. NEW: `@ai-sdk/openai-compatible@^1` (verify exact version exists at install time).
- **Offline-first is a hard rule:** the chat path must never throw or block on a network/runtime failure — degrade to cache/installed/bootstrap.
- Validated HF facts: GGUF list `GET https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=N` (anon, 500 req/5-min/IP — paginate+cap; optional `HF_TOKEN` header `Authorization: Bearer`); `gguf` block (`chat_template`, `total`, `context_length`) on `GET /api/models/<repo>`; sizes on `GET /api/models/<repo>/tree/main` (`{path,size,lfs:{size}}`); pull GGUF via `ollama pull hf.co/<repo>:<quant>`. Tool signal = `chat_template` contains `tools`/`tool_call`/`function`.
- MLX: target a local OpenAI-compatible server (`MLX_BASE_URL`, default `http://localhost:1234/v1`). Ollama's MLX *engine* is >32GB-gated (irrelevant to this adapter).

**Shared interfaces (defined in early tasks; later tasks rely on these exact names):**
```ts
// src/runtime/runtime.ts
export type RuntimeControl = {
  isInstalled(model: string): Promise<boolean>;
  pull(model: string): Promise<void>;
  warm(model: string, numCtx?: number): Promise<void>;
  unload(model: string): Promise<void>;
  listLoaded(): Promise<LoadedModel[]>;          // LoadedModel = { name, sizeBytes }
  getModelMax(model: string): Promise<number | undefined>;
};
export type Runtime = {
  kind: ProviderKind;
  isAvailable(): Promise<boolean>;
  createModel(decl: ModelDeclaration): LanguageModel;
  control: RuntimeControl;
};
// src/runtime/registry.ts
export function runtimeFor(kind: ProviderKind): Runtime;
export async function availableRuntimes(): Promise<Runtime[]>;
export const RUNTIMES: Runtime[];

// src/discovery/catalog-source.ts
export type HostCapabilities = { totalRamBytes: number; liveBudgetBytes: number; runtimes: ProviderKind[] };
export type DiscoveryQuery = { budgetBytes: number; requires?: Capability[]; hostTotalRamBytes: number };
export type Candidate = ModelDeclaration & { repo: string; quant?: string; fileSizeBytes: number; downloads: number; installed: boolean };
export type CatalogSource = { name: string; appliesTo(host: HostCapabilities): boolean; listCandidates(q: DiscoveryQuery): Promise<Candidate[]> };
```

---

### Task 1: Taxonomy extension + selector content-policy filter

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/resource/selector.ts:11-42`
- Test: `tests/resource/selector-policy.test.ts`

**Interfaces:**
- Produces: `Capability.{Vision,Audio,Video}`; `ProviderKind.MlxServer`; `enum ContentPolicy {Default,Uncensored}`; `ModelDeclaration.contentPolicy?`; `ModelRequirement.allowUncensored?`. `selectCandidates` filters out `Uncensored` unless `req.allowUncensored`.

- [ ] **Step 1: Write the failing test** — `tests/resource/selector-policy.test.ts`

```ts
import { expect, test } from 'bun:test';
import {
  Capability, ContentPolicy, type ModelDeclaration, PreferPolicy, ProviderKind,
} from '../../src/core/types.ts';
import { selectCandidates } from '../../src/resource/selector.ts';

function m(model: string, caps: Capability[], policy?: ContentPolicy): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama, model, params: {}, role: 'r',
    capabilities: caps, contentPolicy: policy,
    footprint: { approxParamsBillions: 7, bytesPerWeight: 0.56 },
  };
}
const tools = { role: 'r', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits };

test('uncensored models excluded by default', () => {
  const reg = [m('safe', [Capability.Tools]), m('unc', [Capability.Tools], ContentPolicy.Uncensored)];
  expect(selectCandidates(tools, reg).map((d) => d.model)).toEqual(['safe']);
});
test('uncensored included when allowUncensored', () => {
  const reg = [m('safe', [Capability.Tools]), m('unc', [Capability.Tools], ContentPolicy.Uncensored)];
  const out = selectCandidates({ ...tools, allowUncensored: true }, reg).map((d) => d.model);
  expect(out.sort()).toEqual(['safe', 'unc']);
});
test('vision-only model excluded for a tools requirement', () => {
  const reg = [m('vis', [Capability.Vision]), m('tool', [Capability.Tools])];
  expect(selectCandidates(tools, reg).map((d) => d.model)).toEqual(['tool']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/resource/selector-policy.test.ts`
Expected: FAIL — `ContentPolicy` not exported / `allowUncensored` ignored.

- [ ] **Step 3: Extend the taxonomy** — in `src/core/types.ts`

Replace the `ProviderKind` and `Capability` enums and add `ContentPolicy`:
```ts
/** Which local runtime backs a model. String enum per project style. */
export enum ProviderKind {
  Ollama = 'Ollama',         // GGUF via llama.cpp Metal (MLX engine auto on >32GB hosts)
  MlxServer = 'MlxServer',   // MLX via a local OpenAI-compatible server (LM Studio / vllm-mlx)
}

/** A capability a model advertises and an agent can require. Selector hard-filters on these. */
export enum Capability {
  Tools = 'tools',
  Vision = 'vision', // image input (Slice 8)
  Audio = 'audio',   // speech in/out (Slice 9)
  Video = 'video',   // frames/clips (Slice 10)
}

/** Content moderation posture. Uncensored is gated behind a future mode (Slice 11). */
export enum ContentPolicy {
  Default = 'default',
  Uncensored = 'uncensored',
}
```
Add to `ModelRequirement` (after `prefer`):
```ts
  /** If true, uncensored models are eligible. Absent/false = filtered out. */
  allowUncensored?: boolean;
```
Add to `ModelDeclaration` (after `capabilities?`):
```ts
  /** Moderation posture; absent = Default. */
  contentPolicy?: ContentPolicy;
```

- [ ] **Step 4: Add the content-policy filter** — in `src/resource/selector.ts`

Update the import to include `ContentPolicy`:
```ts
import {
  type Capability, ContentPolicy, type ModelDeclaration, type ModelRequirement,
} from '../core/types.ts';
```
In `selectCandidates`, change the filter line to also drop uncensored unless allowed:
```ts
  const capable = registry.filter(
    (d) =>
      hasAll(d, req.requires) &&
      (req.allowUncensored === true || d.contentPolicy !== ContentPolicy.Uncensored),
  );
```

- [ ] **Step 5: Run tests** — `bun test tests/resource/selector-policy.test.ts` → PASS (3). Then `bun test tests/resource tests/models` → existing selector/registry tests still PASS.

- [ ] **Step 6: Typecheck** — `bun run typecheck` → clean.

- [ ] **Step 7: Commit**
```bash
git add src/core/types.ts src/resource/selector.ts tests/resource/selector-policy.test.ts
git commit -m "feat(core): extend capability/runtime taxonomy + content-policy selector filter"
```

---

### Task 2: Runtime port + Ollama runtime + runtime registry

**Files:**
- Create: `src/runtime/runtime.ts`
- Create: `src/runtime/ollama.ts`
- Create: `src/runtime/registry.ts`
- Test: `tests/runtime/registry.test.ts`

**Interfaces:**
- Consumes: `ollama-control.ts` exports; `createOllamaModel` from `src/providers/ollama.ts`; `ProviderKind`.
- Produces: `RuntimeControl`, `Runtime` (see Global Constraints); `RUNTIMES`, `runtimeFor`, `availableRuntimes`.

- [ ] **Step 1: Write the failing test** — `tests/runtime/registry.test.ts`

```ts
import { expect, test } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { runtimeFor } from '../../src/runtime/registry.ts';

test('runtimeFor returns the Ollama runtime', () => {
  const rt = runtimeFor(ProviderKind.Ollama);
  expect(rt.kind).toBe(ProviderKind.Ollama);
  expect(typeof rt.control.isInstalled).toBe('function');
  expect(typeof rt.createModel).toBe('function');
});
test('runtimeFor throws on an unknown kind', () => {
  expect(() => runtimeFor('nope' as ProviderKind)).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/runtime/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the port** — `src/runtime/runtime.ts`

```ts
import type { LanguageModel } from 'ai';
import type { ModelDeclaration, ProviderKind } from '../core/types.ts';
import type { LoadedModel } from '../resource/ollama-control.ts';

export type { LoadedModel };

/** Lifecycle the Model Manager drives, abstracted per runtime. */
export type RuntimeControl = {
  isInstalled(model: string): Promise<boolean>;
  pull(model: string): Promise<void>;
  warm(model: string, numCtx?: number): Promise<void>;
  unload(model: string): Promise<void>;
  listLoaded(): Promise<LoadedModel[]>;
  getModelMax(model: string): Promise<number | undefined>;
};

/** A model runtime: builds AI-SDK models and owns their lifecycle + availability. */
export type Runtime = {
  kind: ProviderKind;
  isAvailable(): Promise<boolean>;
  createModel(decl: ModelDeclaration): LanguageModel;
  control: RuntimeControl;
};
```

- [ ] **Step 4: Create the Ollama runtime** — `src/runtime/ollama.ts`

```ts
import { ProviderKind } from '../core/types.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import {
  getModelMaxContext, isModelInstalled, listLoadedModels,
  pullModel, unloadModel, warmModel,
} from '../resource/ollama-control.ts';
import type { Runtime } from './runtime.ts';

const BASE = 'http://localhost:11434';

export const ollamaRuntime: Runtime = {
  kind: ProviderKind.Ollama,
  async isAvailable() {
    try {
      const res = await fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  },
  createModel: (decl) => createOllamaModel(decl),
  control: {
    isInstalled: (m) => isModelInstalled(m),
    pull: (m) => pullModel(m),
    warm: (m, n) => warmModel(m, n),
    unload: (m) => unloadModel(m),
    listLoaded: () => listLoadedModels(),
    getModelMax: (m) => getModelMaxContext(m),
  },
};
```

- [ ] **Step 5: Create the registry** — `src/runtime/registry.ts`

```ts
import type { ProviderKind } from '../core/types.ts';
import { mlxServerRuntime } from './mlx-server.ts';
import { ollamaRuntime } from './ollama.ts';
import type { Runtime } from './runtime.ts';

export const RUNTIMES: Runtime[] = [ollamaRuntime, mlxServerRuntime];

export function runtimeFor(kind: ProviderKind): Runtime {
  const rt = RUNTIMES.find((r) => r.kind === kind);
  if (!rt) throw new Error(`No runtime registered for provider ${kind}`);
  return rt;
}

export async function availableRuntimes(): Promise<Runtime[]> {
  const flags = await Promise.all(RUNTIMES.map((r) => r.isAvailable()));
  return RUNTIMES.filter((_, i) => flags[i]);
}
```
NOTE: this imports `./mlx-server.ts` (Task 3). To keep Task 2 self-contained and green, **create a minimal `src/runtime/mlx-server.ts` stub now** exporting a placeholder `mlxServerRuntime` that Task 3 fleshes out:
```ts
// src/runtime/mlx-server.ts (stub; Task 3 implements)
import { ProviderKind } from '../core/types.ts';
import type { Runtime } from './runtime.ts';
export const mlxServerRuntime: Runtime = {
  kind: ProviderKind.MlxServer,
  isAvailable: async () => false,
  createModel: () => { throw new Error('MLX runtime not implemented'); },
  control: {
    isInstalled: async () => false,
    pull: async () => { throw new Error('MLX pull not implemented'); },
    warm: async () => {},
    unload: async () => {},
    listLoaded: async () => [],
    getModelMax: async () => undefined,
  },
};
```

- [ ] **Step 6: Run tests** — `bun test tests/runtime/registry.test.ts` → PASS (2). `bun run typecheck` → clean.

- [ ] **Step 7: Commit**
```bash
git add src/runtime/ tests/runtime/registry.test.ts
git commit -m "feat(runtime): Runtime port + Ollama runtime + runtime registry (MLX stub)"
```

---

### Task 3: MLX-server runtime adapter

**Files:**
- Modify: `package.json` (add `@ai-sdk/openai-compatible`)
- Modify: `src/runtime/mlx-server.ts` (replace the stub)
- Test: `tests/runtime/mlx-server.test.ts`

**Interfaces:**
- Consumes: `Runtime`/`RuntimeControl`; `ProviderKind.MlxServer`.
- Produces: a working `mlxServerRuntime` targeting `MLX_BASE_URL` (default `http://localhost:1234/v1`).

- [ ] **Step 1: Add the dependency**

Run: `bun add @ai-sdk/openai-compatible@^1`
Expected: resolves a 1.x version compatible with `ai@^6`. If `^1` does not exist, run `bun pm view @ai-sdk/openai-compatible versions` and pin the latest 1.x; record it in the commit.

- [ ] **Step 2: Write the failing test** — `tests/runtime/mlx-server.test.ts`

```ts
import { expect, test } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { mlxServerRuntime } from '../../src/runtime/mlx-server.ts';

test('mlx runtime has the right kind and builds a model', () => {
  expect(mlxServerRuntime.kind).toBe(ProviderKind.MlxServer);
  const model = mlxServerRuntime.createModel({
    provider: ProviderKind.MlxServer, model: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
    params: {}, role: 'r', footprint: { approxParamsBillions: 7, bytesPerWeight: 0.55 },
  });
  expect(model).toBeDefined();
});

test('isInstalled reads /v1/models', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [{ id: 'mlx-community/Qwen2.5-7B-Instruct-4bit' }] }),
      { status: 200 })) as typeof fetch;
  try {
    expect(await mlxServerRuntime.control.isInstalled('mlx-community/Qwen2.5-7B-Instruct-4bit')).toBe(true);
    expect(await mlxServerRuntime.control.isInstalled('absent')).toBe(false);
  } finally {
    globalThis.fetch = origFetch;
  }
});
```

- [ ] **Step 3: Run test to verify it fails** — `bun test tests/runtime/mlx-server.test.ts` → FAIL (stub throws / returns false).

- [ ] **Step 4: Implement** — replace `src/runtime/mlx-server.ts`

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ProviderKind } from '../core/types.ts';
import type { ModelDeclaration } from '../core/types.ts';
import type { LoadedModel, Runtime } from './runtime.ts';

const BASE = process.env.MLX_BASE_URL ?? 'http://localhost:1234/v1';

const provider = createOpenAICompatible({ name: 'mlx-server', baseURL: BASE });

async function listIds(): Promise<string[]> {
  try {
    const res = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id);
  } catch {
    return [];
  }
}

/**
 * MLX models run via a local OpenAI-compatible server (LM Studio / vllm-mlx).
 * The server owns model download/load, so `pull`/`warm`/`unload` are best-effort:
 * a model must be loaded in the server; we surface a clear message if it is not.
 */
export const mlxServerRuntime: Runtime = {
  kind: ProviderKind.MlxServer,
  async isAvailable() {
    try {
      const res = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  },
  createModel: (decl: ModelDeclaration) => provider(decl.model),
  control: {
    isInstalled: async (m) => (await listIds()).includes(m),
    pull: async (m) => {
      if ((await listIds()).includes(m)) return;
      throw new Error(`MLX model "${m}" is not loaded in the MLX server at ${BASE}. Load it there (e.g. in LM Studio), then retry.`);
    },
    warm: async () => {},
    unload: async () => {},
    listLoaded: async (): Promise<LoadedModel[]> =>
      (await listIds()).map((name) => ({ name, sizeBytes: 0 })),
    getModelMax: async () => undefined,
  },
};
```

- [ ] **Step 5: Run tests** — `bun test tests/runtime/mlx-server.test.ts` → PASS (2). `bun run typecheck` → clean.

- [ ] **Step 6: Commit**
```bash
git add package.json bun.lock src/runtime/mlx-server.ts tests/runtime/mlx-server.test.ts
git commit -m "feat(runtime): MLX-server runtime adapter (OpenAI-compatible local server)"
```

---

### Task 4: Model Manager drives lifecycle via the runtime registry

**Files:**
- Modify: `src/resource/model-manager.ts:24-153`
- Modify: `tests/resource/model-manager.test.ts` (update fakes to the new deps shape)
- Test: existing `tests/resource/model-manager.test.ts` + a new routing assertion

**Interfaces:**
- Consumes: `runtimeFor` (Task 2); `ModelDeclaration` (has `provider`).
- Produces: `ManagerDeps` now `{ budgetBytes, warn, controlFor }`; `controlFor(decl) => RuntimeControl`. `ensureReady`/`unloadAll` behavior unchanged otherwise.

- [ ] **Step 1: Write the failing test** — append to `tests/resource/model-manager.test.ts`

First, the existing `fakes()` helper must change shape. Replace it with:
```ts
import { ProviderKind } from '../../src/core/types.ts';
import type { RuntimeControl } from '../../src/runtime/runtime.ts';

function fakeControl(over: Partial<RuntimeControl> = {}): RuntimeControl {
  return {
    isInstalled: mock(async () => true),
    pull: mock(async () => {}),
    warm: mock(async () => {}),
    unload: mock(async () => {}),
    listLoaded: mock(async () => [] as { name: string; sizeBytes: number }[]),
    getModelMax: mock(async () => 262144),
    ...over,
  };
}
function fakes(overrides: { control?: RuntimeControl; budgetBytes?: number; warn?: (m: string) => void } = {}) {
  const control = overrides.control ?? fakeControl();
  return {
    control,
    deps: {
      budgetBytes: overrides.budgetBytes ?? 100e9,
      warn: overrides.warn ?? mock(() => {}),
      controlFor: () => control,
    },
  };
}
```
Then update each existing test to construct the manager as `createModelManager(fakes({...}).deps)` and assert against `fakes(...).control.warm` etc. Add ONE new routing test:
```ts
test('routes lifecycle through controlFor(decl.provider)', async () => {
  const f = fakes();
  const mgr = createModelManager(f.deps);
  await mgr.ensureReady({
    provider: ProviderKind.Ollama, model: 'm7', params: { numCtx: 0 }, role: 't',
    footprint: { approxParamsBillions: 7, bytesPerWeight: 1 },
  });
  expect(f.control.warm).toHaveBeenCalledWith('m7', expect.any(Number));
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun test tests/resource/model-manager.test.ts` → FAIL (deps shape mismatch / `controlFor` unused).

- [ ] **Step 3: Refactor the manager** — `src/resource/model-manager.ts`

Replace imports + `ManagerDeps` + `defaultDeps` + the `d.*` calls:
```ts
import { ResourceError } from '../core/errors.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { runtimeFor } from '../runtime/registry.ts';
import type { LoadedModel, RuntimeControl } from '../runtime/runtime.ts';
import { kvCacheBytes, weightsBytes } from './footprint.ts';
import { liveBudgetBytes } from './hardware.ts';

export const MIN_CTX = 4096;
const DEFAULT_KV_PER_TOKEN = 131072;
const CTX_ROUNDING = 1024;

export type EnsureOpts = { pinned?: string[] };
export type BudgetSource = number | (() => number | Promise<number>);

export type ManagerDeps = {
  budgetBytes: BudgetSource;
  warn: (message: string) => void;
  /** Resolve the lifecycle control for a declaration's runtime. */
  controlFor: (decl: ModelDeclaration) => RuntimeControl;
};

function defaultDeps(): ManagerDeps {
  return {
    budgetBytes: liveBudgetBytes,
    warn: (message) => console.error(message),
    controlFor: (decl) => runtimeFor(decl.provider).control,
  };
}
```
In `ensureReady`, resolve control once and use it everywhere `d.isInstalled/pull/listLoaded/unload/warm/getModelMax` was used:
```ts
  async function ensureReady(decl: ModelDeclaration, opts: EnsureOpts = {}): Promise<number> {
    const c = d.controlFor(decl);
    const pinned = new Set(opts.pinned ?? []);
    const target = decl.model;
    const desired = decl.params.numCtx ?? MIN_CTX;

    if (!(await c.isInstalled(target))) await c.pull(target);
    let loaded = await c.listLoaded();
    // ...unchanged fit/evict loop, but call c.unload(...) instead of d.unload(...)...
    // ...modelMaxFor must use the control too (see below)...
    await c.warm(target, chosenCtx);
    // ...
  }
```
`modelMaxFor` needs the control; make it take the decl/control:
```ts
  async function modelMaxFor(c: RuntimeControl, model: string): Promise<number | undefined> {
    const cached = maxCtxByModel.get(model);
    if (cached !== undefined) return cached;
    let probed: number | undefined;
    try { probed = await c.getModelMax(model); } catch { probed = undefined; }
    if (probed !== undefined) maxCtxByModel.set(model, probed);
    return probed;
  }
```
and call `await modelMaxFor(c, target)`. `unloadAll` must route per model — track the provider with each loaded model. Change the `lastUsed` bookkeeping to also remember the decl/provider:
```ts
  const runtimeByModel = new Map<string, ModelDeclaration>(); // remember how to unload
  // in ensureReady after success: runtimeByModel.set(target, decl);
  async function unloadAll(): Promise<void> {
    for (const model of [...lastUsed.keys()]) {
      const decl = runtimeByModel.get(model);
      if (decl) await d.controlFor(decl).unload(model);
    }
    lastUsed.clear(); chosenCtxByModel.clear(); runtimeByModel.clear();
  }
```
(Keep the eviction `c.unload(evict.name)` inside `ensureReady` — eviction happens within one runtime's loaded set; `listLoaded()` is that runtime's resident set.)

- [ ] **Step 4: Run tests** — `bun test tests/resource/model-manager.test.ts` → PASS (all existing + the new routing test). `bun run typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/resource/model-manager.ts tests/resource/model-manager.test.ts
git commit -m "refactor(resource): manager drives lifecycle via runtimeFor(decl.provider)"
```

---

### Task 5: Quant → bytes-per-weight + pick-best-quant

**Files:**
- Create: `src/discovery/quant.ts`
- Test: `tests/discovery/quant.test.ts`

**Interfaces:**
- Produces: `bytesPerWeightForQuant(quant: string): number`; `pickBestQuantThatFits(files: QuantFile[], budgetBytes: number): QuantFile | undefined`; `type QuantFile = { quant: string; sizeBytes: number }`.

- [ ] **Step 1: Write the failing test** — `tests/discovery/quant.test.ts`

```ts
import { expect, test } from 'bun:test';
import { bytesPerWeightForQuant, pickBestQuantThatFits } from '../../src/discovery/quant.ts';

test('maps common GGUF quants to bytes/weight', () => {
  expect(bytesPerWeightForQuant('Q4_K_M')).toBeCloseTo(0.56, 2);
  expect(bytesPerWeightForQuant('Q8_0')).toBeGreaterThan(1.0);
  expect(bytesPerWeightForQuant('unknown')).toBeGreaterThan(0); // safe default
});
test('picks the largest quant whose file fits the budget', () => {
  const files = [
    { quant: 'Q4_K_M', sizeBytes: 5e9 },
    { quant: 'Q6_K', sizeBytes: 7e9 },
    { quant: 'Q8_0', sizeBytes: 9e9 },
  ];
  expect(pickBestQuantThatFits(files, 8e9)?.quant).toBe('Q6_K');
  expect(pickBestQuantThatFits(files, 4e9)).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/discovery/quant.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/discovery/quant.ts`

```ts
export type QuantFile = { quant: string; sizeBytes: number };

/** Approximate bytes-per-weight for common GGUF/MLX quant labels. */
const BPW: Record<string, number> = {
  Q2_K: 0.34, Q3_K_M: 0.43, Q4_0: 0.56, Q4_K_M: 0.56, Q4_K_S: 0.52,
  Q5_K_M: 0.70, Q5_0: 0.68, Q6_K: 0.82, Q8_0: 1.06,
  IQ4_XS: 0.5, '4BIT': 0.55, '8BIT': 1.06, FP16: 2.0, F16: 2.0,
};

/** Bytes/weight for a quant label (case-insensitive); falls back to Q4_K_M-ish. */
export function bytesPerWeightForQuant(quant: string): number {
  return BPW[quant.toUpperCase()] ?? 0.6;
}

/** Largest quant file that fits the budget (file size ≈ weights footprint). */
export function pickBestQuantThatFits(files: QuantFile[], budgetBytes: number): QuantFile | undefined {
  return [...files]
    .filter((f) => f.sizeBytes <= budgetBytes)
    .sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
}
```

- [ ] **Step 4: Run** — `bun test tests/discovery/quant.test.ts` → PASS (2). `bun run typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/discovery/quant.ts tests/discovery/quant.test.ts
git commit -m "feat(discovery): quant->bytes-per-weight map + pick-best-quant-that-fits"
```

---

### Task 6: HF client + CatalogSource port types

**Files:**
- Create: `src/discovery/hf-client.ts`
- Create: `src/discovery/catalog-source.ts`
- Test: `tests/discovery/hf-client.test.ts`

**Interfaces:**
- Produces: `hfGet(path: string): Promise<unknown>` (anonymous; adds `Authorization: Bearer $HF_TOKEN` when set; throws `DiscoveryError` on failure); the port types `HostCapabilities`/`DiscoveryQuery`/`Candidate`/`CatalogSource` (see Global Constraints); `class DiscoveryError extends Error`.

- [ ] **Step 1: Write the failing test** — `tests/discovery/hf-client.test.ts`

```ts
import { afterEach, expect, test } from 'bun:test';
import { hfGet } from '../../src/discovery/hf-client.ts';

const orig = globalThis.fetch;
afterEach(() => { globalThis.fetch = orig; delete process.env.HF_TOKEN; });

test('parses JSON from a successful response', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })) as typeof fetch;
  expect(await hfGet('/api/models?filter=gguf')).toEqual({ ok: 1 });
});
test('adds bearer auth when HF_TOKEN is set', async () => {
  process.env.HF_TOKEN = 'tok';
  let seen: Headers | undefined;
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    seen = new Headers(init?.headers); return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  await hfGet('/api/models');
  expect(seen?.get('authorization')).toBe('Bearer tok');
});
test('throws DiscoveryError on non-ok', async () => {
  globalThis.fetch = (async () => new Response('nope', { status: 429 })) as typeof fetch;
  await expect(hfGet('/api/models')).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/discovery/hf-client.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/discovery/catalog-source.ts`

```ts
import type { Capability, ModelDeclaration, ProviderKind } from '../core/types.ts';

export class DiscoveryError extends Error {}

export type HostCapabilities = {
  totalRamBytes: number;
  liveBudgetBytes: number;
  runtimes: ProviderKind[];
};
export type DiscoveryQuery = {
  budgetBytes: number;
  requires?: Capability[];
  hostTotalRamBytes: number;
};
export type Candidate = ModelDeclaration & {
  repo: string;
  quant?: string;
  fileSizeBytes: number;
  downloads: number;
  installed: boolean;
};
export type CatalogSource = {
  name: string;
  appliesTo(host: HostCapabilities): boolean;
  listCandidates(q: DiscoveryQuery): Promise<Candidate[]>;
};
```
`src/discovery/hf-client.ts`:
```ts
import { DiscoveryError } from './catalog-source.ts';

const HF = 'https://huggingface.co';

/** Anonymous HF GET (adds bearer auth if HF_TOKEN is set). Throws DiscoveryError on failure. */
export async function hfGet(path: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  const token = process.env.HF_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${HF}${path}`, { headers, signal: AbortSignal.timeout(8000) });
  } catch (cause) {
    throw new DiscoveryError(`HF GET ${path} failed`, { cause });
  }
  if (!res.ok) throw new DiscoveryError(`HF GET ${path} returned ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Run** — `bun test tests/discovery/hf-client.test.ts` → PASS (3). `bun run typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/discovery/hf-client.ts src/discovery/catalog-source.ts tests/discovery/hf-client.test.ts
git commit -m "feat(discovery): HF client + CatalogSource port types"
```

---

### Task 7: Hugging Face GGUF source

**Files:**
- Create: `src/discovery/huggingface-gguf.ts`
- Test: `tests/discovery/huggingface-gguf.test.ts`

**Interfaces:**
- Consumes: `hfGet`, `Candidate`/`CatalogSource`/`DiscoveryQuery`/`HostCapabilities`, `bytesPerWeightForQuant`/`pickBestQuantThatFits`, `Capability`/`ContentPolicy`/`ProviderKind`.
- Produces: `hfGgufSource: CatalogSource` (name `'hf-gguf'`); helper `detectTools(chatTemplate: string): boolean`; `TRUSTED_PUBLISHERS: string[]`.

- [ ] **Step 1: Write the failing test** — `tests/discovery/huggingface-gguf.test.ts`

```ts
import { afterEach, expect, test } from 'bun:test';
import { Capability, ProviderKind } from '../../src/core/types.ts';
import { detectTools, hfGgufSource } from '../../src/discovery/huggingface-gguf.ts';

test('detectTools reads tool markers from a chat template', () => {
  expect(detectTools('{%- if tools %}...tool_call...')).toBe(true);
  expect(detectTools('plain chat template')).toBe(false);
});

const orig = globalThis.fetch;
afterEach(() => { globalThis.fetch = orig; });

test('builds a fitting tool-capable GGUF candidate', async () => {
  const routes: Record<string, unknown> = {
    '/api/models?filter=gguf&author=bartowski&sort=downloads&direction=-1&limit=20':
      [{ id: 'bartowski/Qwen2.5-7B-Instruct-GGUF', downloads: 9999 }],
    '/api/models/bartowski/Qwen2.5-7B-Instruct-GGUF':
      { gguf: { total: 7_600_000_000, context_length: 32768, chat_template: '{%- if tools %} tool_call' } },
    '/api/models/bartowski/Qwen2.5-7B-Instruct-GGUF/tree/main':
      [{ path: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', size: 4_700_000_000 }],
  };
  globalThis.fetch = (async (u: string) => {
    const path = u.replace('https://huggingface.co', '');
    const body = routes[path] ?? routes[decodeURIComponent(path)];
    return new Response(JSON.stringify(body ?? null), { status: body ? 200 : 404 });
  }) as typeof fetch;

  const cands = await hfGgufSource.listCandidates({
    budgetBytes: 12e9, requires: [Capability.Tools], hostTotalRamBytes: 24e9,
  });
  expect(cands.length).toBe(1);
  expect(cands[0].provider).toBe(ProviderKind.Ollama);
  expect(cands[0].model).toBe('hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M');
  expect(cands[0].capabilities).toContain(Capability.Tools);
  expect(cands[0].quant).toBe('Q4_K_M');
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/discovery/huggingface-gguf.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/discovery/huggingface-gguf.ts`

```ts
import { Capability, ContentPolicy, type ModelDeclaration, ProviderKind } from '../core/types.ts';
import type { Candidate, CatalogSource, DiscoveryQuery, HostCapabilities } from './catalog-source.ts';
import { hfGet } from './hf-client.ts';
import { bytesPerWeightForQuant, pickBestQuantThatFits, type QuantFile } from './quant.ts';

export const TRUSTED_PUBLISHERS = ['bartowski', 'unsloth', 'MaziyarPanahi', 'Qwen', 'lmstudio-community'];
const PER_AUTHOR_LIMIT = 20;
const UNCENSORED_RE = /(abliterated|uncensored|dolphin)/i;
const QUANT_RE = /-(IQ?\d[\w_]*|Q\d[\w_]*|F16|FP16)\.gguf$/i;

/** True if a chat template exposes tool/function calling. */
export function detectTools(chatTemplate: string): boolean {
  return /tool_call|tools|function/i.test(chatTemplate);
}

type ListItem = { id: string; downloads?: number };
type GgufInfo = { gguf?: { total?: number; context_length?: number; chat_template?: string } };
type TreeEntry = { path: string; size?: number; lfs?: { size?: number } };

function quantOf(path: string): string | undefined {
  const m = path.match(QUANT_RE);
  return m ? m[1].toUpperCase() : undefined;
}

async function candidateFor(item: ListItem, q: DiscoveryQuery): Promise<Candidate | undefined> {
  const repo = item.id;
  let info: GgufInfo;
  try { info = (await hfGet(`/api/models/${repo}`)) as GgufInfo; } catch { return undefined; }
  const tmpl = info.gguf?.chat_template ?? '';
  if (q.requires?.includes(Capability.Tools) && !detectTools(tmpl)) return undefined;

  let tree: TreeEntry[];
  try { tree = (await hfGet(`/api/models/${repo}/tree/main`)) as TreeEntry[]; } catch { return undefined; }
  const files: QuantFile[] = [];
  for (const e of tree) {
    const quant = quantOf(e.path);
    const sizeBytes = e.lfs?.size ?? e.size;
    if (quant && typeof sizeBytes === 'number') files.push({ quant, sizeBytes });
  }
  const best = pickBestQuantThatFits(files, q.budgetBytes);
  if (!best) return undefined;

  const params = (info.gguf?.total ?? 0) / 1e9;
  const decl: ModelDeclaration = {
    provider: ProviderKind.Ollama,
    model: `hf.co/${repo}:${best.quant}`,
    params: {},
    role: 'discovered general reasoning + tool use',
    capabilities: detectTools(tmpl) ? [Capability.Tools] : [],
    contentPolicy: UNCENSORED_RE.test(repo) ? ContentPolicy.Uncensored : ContentPolicy.Default,
    footprint: {
      approxParamsBillions: params > 0 ? params : best.sizeBytes / 1e9 / bytesPerWeightForQuant(best.quant),
      bytesPerWeight: bytesPerWeightForQuant(best.quant),
    },
    maxContext: info.gguf?.context_length,
  };
  return { ...decl, repo, quant: best.quant, fileSizeBytes: best.sizeBytes, downloads: item.downloads ?? 0, installed: false };
}

export const hfGgufSource: CatalogSource = {
  name: 'hf-gguf',
  appliesTo: (_host: HostCapabilities) => true, // Ollama runs GGUF on every host
  async listCandidates(q: DiscoveryQuery): Promise<Candidate[]> {
    const items: ListItem[] = [];
    for (const author of TRUSTED_PUBLISHERS) {
      try {
        const page = (await hfGet(
          `/api/models?filter=gguf&author=${author}&sort=downloads&direction=-1&limit=${PER_AUTHOR_LIMIT}`,
        )) as ListItem[];
        items.push(...page);
      } catch { /* skip this author on failure; degrade gracefully */ }
    }
    const out: Candidate[] = [];
    for (const item of items) {
      const c = await candidateFor(item, q);
      if (c) out.push(c);
    }
    return out;
  },
};
```

- [ ] **Step 4: Run** — `bun test tests/discovery/huggingface-gguf.test.ts` → PASS (2). `bun run typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/discovery/huggingface-gguf.ts tests/discovery/huggingface-gguf.test.ts
git commit -m "feat(discovery): Hugging Face GGUF catalog source (two-phase, tool-capable, fits-budget)"
```

---

### Task 8: Hugging Face MLX source

**Files:**
- Create: `src/discovery/huggingface-mlx.ts`
- Test: `tests/discovery/huggingface-mlx.test.ts`

**Interfaces:**
- Consumes: same as Task 7 + `ProviderKind.MlxServer`.
- Produces: `hfMlxSource: CatalogSource` (name `'hf-mlx'`); `appliesTo` true only when the host lists `ProviderKind.MlxServer`.

- [ ] **Step 1: Write the failing test** — `tests/discovery/huggingface-mlx.test.ts`

```ts
import { afterEach, expect, test } from 'bun:test';
import { Capability, ProviderKind } from '../../src/core/types.ts';
import { hfMlxSource } from '../../src/discovery/huggingface-mlx.ts';

test('applies only when an MLX runtime is present on the host', () => {
  const base = { totalRamBytes: 24e9, liveBudgetBytes: 12e9 };
  expect(hfMlxSource.appliesTo({ ...base, runtimes: [ProviderKind.Ollama] })).toBe(false);
  expect(hfMlxSource.appliesTo({ ...base, runtimes: [ProviderKind.Ollama, ProviderKind.MlxServer] })).toBe(true);
});

const orig = globalThis.fetch;
afterEach(() => { globalThis.fetch = orig; });

test('builds an MLX candidate from config.json + chat_template + tree', async () => {
  const routes: Record<string, unknown> = {
    '/api/models?filter=mlx&author=mlx-community&sort=downloads&direction=-1&limit=20':
      [{ id: 'mlx-community/Qwen2.5-7B-Instruct-4bit', downloads: 500 }],
    '/api/models/mlx-community/Qwen2.5-7B-Instruct-4bit':
      { config: { num_parameters: 7_600_000_000 } },
    '/resolve/main/config.json': { num_parameters: 7_600_000_000 },
    '/resolve/main/tokenizer_config.json': { chat_template: '{%- if tools %} tool_call' },
    '/api/models/mlx-community/Qwen2.5-7B-Instruct-4bit/tree/main':
      [{ path: 'model.safetensors', size: 4_300_000_000 }],
  };
  globalThis.fetch = (async (u: string) => {
    const path = u.replace('https://huggingface.co', '').replace('/mlx-community/Qwen2.5-7B-Instruct-4bit', (m: string) => m);
    const key = Object.keys(routes).find((k) => u.includes(k));
    const body = key ? routes[key] : null;
    return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
  }) as typeof fetch;

  const cands = await hfMlxSource.listCandidates({
    budgetBytes: 12e9, requires: [Capability.Tools], hostTotalRamBytes: 24e9,
  });
  expect(cands.length).toBe(1);
  expect(cands[0].provider).toBe(ProviderKind.MlxServer);
  expect(cands[0].model).toBe('mlx-community/Qwen2.5-7B-Instruct-4bit');
  expect(cands[0].capabilities).toContain(Capability.Tools);
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/discovery/huggingface-mlx.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/discovery/huggingface-mlx.ts`

```ts
import { Capability, ContentPolicy, type ModelDeclaration, ProviderKind } from '../core/types.ts';
import type { Candidate, CatalogSource, DiscoveryQuery, HostCapabilities } from './catalog-source.ts';
import { detectTools } from './huggingface-gguf.ts';
import { hfGet } from './hf-client.ts';

const TRUSTED = ['mlx-community'];
const LIMIT = 20;
const UNCENSORED_RE = /(abliterated|uncensored|dolphin)/i;

type ListItem = { id: string; downloads?: number };
type TreeEntry = { path: string; size?: number; lfs?: { size?: number } };
type TokCfg = { chat_template?: string };
type Cfg = { num_parameters?: number };

async function candidateFor(item: ListItem, q: DiscoveryQuery): Promise<Candidate | undefined> {
  const repo = item.id;
  let tok: TokCfg;
  try { tok = (await hfGet(`/${repo}/resolve/main/tokenizer_config.json`)) as TokCfg; } catch { return undefined; }
  const tmpl = tok.chat_template ?? '';
  if (q.requires?.includes(Capability.Tools) && !detectTools(tmpl)) return undefined;

  let cfg: Cfg = {};
  try { cfg = (await hfGet(`/${repo}/resolve/main/config.json`)) as Cfg; } catch { /* params optional */ }

  let tree: TreeEntry[];
  try { tree = (await hfGet(`/api/models/${repo}/tree/main`)) as TreeEntry[]; } catch { return undefined; }
  const total = tree
    .filter((e) => e.path.endsWith('.safetensors'))
    .reduce((s, e) => s + (e.lfs?.size ?? e.size ?? 0), 0);
  if (total === 0 || total > q.budgetBytes) return undefined;

  const params = (cfg.num_parameters ?? 0) / 1e9;
  const bpw = params > 0 ? total / 1e9 / params : 0.55;
  const decl: ModelDeclaration = {
    provider: ProviderKind.MlxServer,
    model: repo,
    params: {},
    role: 'discovered MLX general reasoning + tool use',
    capabilities: [Capability.Tools],
    contentPolicy: UNCENSORED_RE.test(repo) ? ContentPolicy.Uncensored : ContentPolicy.Default,
    footprint: { approxParamsBillions: params > 0 ? params : total / 1e9 / 0.55, bytesPerWeight: bpw },
  };
  return { ...decl, repo, quant: '4bit', fileSizeBytes: total, downloads: item.downloads ?? 0, installed: false };
}

export const hfMlxSource: CatalogSource = {
  name: 'hf-mlx',
  appliesTo: (host: HostCapabilities) => host.runtimes.includes(ProviderKind.MlxServer),
  async listCandidates(q: DiscoveryQuery): Promise<Candidate[]> {
    const items: ListItem[] = [];
    for (const author of TRUSTED) {
      try {
        const page = (await hfGet(
          `/api/models?filter=mlx&author=${author}&sort=downloads&direction=-1&limit=${LIMIT}`,
        )) as ListItem[];
        items.push(...page);
      } catch { /* degrade */ }
    }
    const out: Candidate[] = [];
    for (const item of items) { const c = await candidateFor(item, q); if (c) out.push(c); }
    return out;
  },
};
```

- [ ] **Step 4: Run** — `bun test tests/discovery/huggingface-mlx.test.ts` → PASS (2). `bun run typecheck` → clean. (If the route-matching in the test proves fragile, simplify the test's fetch stub to match on `u.includes(key)` — the assertion targets are the candidate fields, not the stub mechanics.)

- [ ] **Step 5: Commit**
```bash
git add src/discovery/huggingface-mlx.ts tests/discovery/huggingface-mlx.test.ts
git commit -m "feat(discovery): Hugging Face MLX catalog source (config.json + chat_template)"
```

---

### Task 9: Host detector + catalog cache

**Files:**
- Create: `src/discovery/host.ts`
- Create: `src/discovery/catalog-cache.ts`
- Test: `tests/discovery/catalog-cache.test.ts`

**Interfaces:**
- Consumes: `availableRuntimes` (Task 2); `liveBudgetBytes`, `machineBudgetBytes`/`os.totalmem` via `hardware.ts`; `Candidate`.
- Produces: `detectHost(): Promise<HostCapabilities>`; `readCatalog(path?): Candidate[] | undefined`; `writeCatalog(cands, path?): void`; `catalogPath(): string`; `isStale(ttlMs, path?): boolean`.

- [ ] **Step 1: Write the failing test** — `tests/discovery/catalog-cache.test.ts`

```ts
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isStale, readCatalog, writeCatalog } from '../../src/discovery/catalog-cache.ts';
import { ProviderKind } from '../../src/core/types.ts';

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('write then read round-trips candidates', () => {
  dir = mkdtempSync(join(tmpdir(), 'cat-'));
  const p = join(dir, 'catalog.json');
  const cands = [{
    provider: ProviderKind.Ollama, model: 'hf.co/x:Q4_K_M', params: {}, role: 'r',
    footprint: { approxParamsBillions: 7, bytesPerWeight: 0.56 },
    repo: 'x', quant: 'Q4_K_M', fileSizeBytes: 5e9, downloads: 1, installed: false,
  }];
  writeCatalog(cands, p);
  expect(readCatalog(p)?.[0].model).toBe('hf.co/x:Q4_K_M');
});
test('missing file → undefined and stale', () => {
  dir = mkdtempSync(join(tmpdir(), 'cat-'));
  const p = join(dir, 'none.json');
  expect(readCatalog(p)).toBeUndefined();
  expect(isStale(1000, p)).toBe(true);
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/discovery/catalog-cache.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/discovery/catalog-cache.ts`

```ts
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candidate } from './catalog-source.ts';

/** Per-machine, git-ignored cache co-located with the model store. */
export function catalogPath(): string {
  return join(process.cwd(), 'model-images', 'catalog.json');
}

export function readCatalog(path: string = catalogPath()): Candidate[] | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const data = JSON.parse(readFileSync(path, 'utf8')) as { candidates?: Candidate[] };
    return data.candidates;
  } catch {
    return undefined; // corrupt cache → treat as absent
  }
}

/** Atomic write (temp + rename) so a failure never corrupts an existing catalog. */
export function writeCatalog(candidates: Candidate[], path: string = catalogPath()): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ writtenAt: new Date().toISOString(), candidates }, null, 2));
  renameSync(tmp, path);
}

export function isStale(ttlMs: number, path: string = catalogPath()): boolean {
  try {
    if (!existsSync(path)) return true;
    return Date.now() - statSync(path).mtimeMs > ttlMs;
  } catch {
    return true;
  }
}
```
`src/discovery/host.ts`:
```ts
import { totalmem } from 'node:os';
import type { HostCapabilities } from './catalog-source.ts';
import { liveBudgetBytes } from '../resource/hardware.ts';
import { availableRuntimes } from '../runtime/registry.ts';

/** Detect what this machine can run right now: RAM, live budget, reachable runtimes. */
export async function detectHost(): Promise<HostCapabilities> {
  const runtimes = (await availableRuntimes()).map((r) => r.kind);
  return { totalRamBytes: totalmem(), liveBudgetBytes: await liveBudgetBytes(), runtimes };
}
```
> NOTE: `new Date()` is fine here (real runtime code, not a workflow script). Tests assert structure/round-trip, not timestamps.

- [ ] **Step 4: Run** — `bun test tests/discovery/catalog-cache.test.ts` → PASS (2). `bun run typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/discovery/host.ts src/discovery/catalog-cache.ts tests/discovery/catalog-cache.test.ts
git commit -m "feat(discovery): host-capability detector + atomic catalog cache"
```

---

### Task 10: Discovery pipeline + offline registry builder

**Files:**
- Create: `src/discovery/discover.ts`
- Create: `src/discovery/build-registry.ts`
- Create: `src/discovery/sources.ts` (the source registry)
- Test: `tests/discovery/build-registry.test.ts`, `tests/discovery/discover.test.ts`

**Interfaces:**
- Consumes: sources (Tasks 7–8), `detectHost`, cache (Task 9), `runtimeFor`/`availableRuntimes`, `BOOTSTRAP` (Task 11 renames `REGISTRY`; until then import `REGISTRY`), `Candidate`/`ModelDeclaration`.
- Produces: `SOURCES: CatalogSource[]`; `runDiscovery(deps?): Promise<{found,fits,pulled,path}>`; `buildRegistry(deps?): Promise<ModelDeclaration[]>`.

- [ ] **Step 1: Write the failing tests**

`tests/discovery/build-registry.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { buildRegistry } from '../../src/discovery/build-registry.ts';

const bootstrap = [{
  provider: ProviderKind.Ollama, model: 'qwen3.5:4b', params: {}, role: 'r',
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
}];

test('merges bootstrap + installed + catalog, deduped by (provider,model)', async () => {
  const reg = await buildRegistry({
    bootstrap,
    installed: async () => [{ provider: ProviderKind.Ollama, model: 'qwen3.5:9b', params: {}, role: 'i',
      footprint: { approxParamsBillions: 9, bytesPerWeight: 0.56 } }],
    readCatalog: () => [{ provider: ProviderKind.Ollama, model: 'qwen3.5:4b', params: {}, role: 'c',
      footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
      repo: 'x', fileSizeBytes: 1, downloads: 1, installed: true }],
  });
  expect(reg.map((d) => d.model).sort()).toEqual(['qwen3.5:4b', 'qwen3.5:9b']); // 4b deduped
});

test('offline: installed throws and catalog missing → still returns bootstrap (no throw)', async () => {
  const reg = await buildRegistry({
    bootstrap,
    installed: async () => { throw new Error('offline'); },
    readCatalog: () => undefined,
  });
  expect(reg.map((d) => d.model)).toEqual(['qwen3.5:4b']);
});
```
`tests/discovery/discover.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { Capability, ProviderKind } from '../../src/core/types.ts';
import { runDiscovery } from '../../src/discovery/discover.ts';

test('fetches from applicable sources, filters/ranks, writes, pre-pulls top-1', async () => {
  const c = (model: string, dl: number, params: number) => ({
    provider: ProviderKind.Ollama, model, params: {}, role: 'r', capabilities: [Capability.Tools],
    footprint: { approxParamsBillions: params, bytesPerWeight: 0.56 },
    repo: model, quant: 'Q4_K_M', fileSizeBytes: params * 0.56e9 * 1.2, downloads: dl, installed: false,
  });
  const pulled: string[] = [];
  const out = await runDiscovery({
    host: { totalRamBytes: 24e9, liveBudgetBytes: 12e9, runtimes: [ProviderKind.Ollama] },
    sources: [{ name: 's', appliesTo: () => true, listCandidates: async () => [c('hf.co/a:Q4_K_M', 10, 7), c('hf.co/b:Q4_K_M', 99, 9)] }],
    writeCatalog: () => {},
    pullTop: async (m) => { pulled.push(m); },
    catalogPathStr: '/tmp/catalog.json',
  });
  expect(out.found).toBe(2);
  expect(pulled).toEqual(['hf.co/b:Q4_K_M']); // highest downloads, pre-pulled
});
```

- [ ] **Step 2: Run to verify fail** — `bun test tests/discovery/build-registry.test.ts tests/discovery/discover.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/discovery/sources.ts`:
```ts
import type { CatalogSource } from './catalog-source.ts';
import { hfGgufSource } from './huggingface-gguf.ts';
import { hfMlxSource } from './huggingface-mlx.ts';

export const SOURCES: CatalogSource[] = [hfGgufSource, hfMlxSource];
```
`src/discovery/build-registry.ts`:
```ts
import type { ModelDeclaration } from '../core/types.ts';
import { REGISTRY } from '../../models/registry.ts'; // becomes BOOTSTRAP in Task 11
import { availableRuntimes } from '../runtime/registry.ts';
import { readCatalog } from './catalog-cache.ts';
import type { Candidate } from './catalog-source.ts';

export type BuildRegistryDeps = {
  bootstrap?: ModelDeclaration[];
  installed?: () => Promise<ModelDeclaration[]>;
  readCatalog?: () => Candidate[] | undefined;
};

async function installedFromRuntimes(): Promise<ModelDeclaration[]> {
  const out: ModelDeclaration[] = [];
  for (const rt of await availableRuntimes()) {
    try {
      for (const m of await rt.control.listLoaded()) {
        out.push({ provider: rt.kind, model: m.name, params: {}, role: 'installed',
          footprint: { approxParamsBillions: 0, bytesPerWeight: 0 } });
      }
    } catch { /* runtime down → contributes nothing */ }
  }
  return out;
}

/** OFFLINE-SAFE merge: bootstrap ∪ installed ∪ cached catalog, deduped by (provider,model). */
export async function buildRegistry(deps: BuildRegistryDeps = {}): Promise<ModelDeclaration[]> {
  const bootstrap = deps.bootstrap ?? REGISTRY;
  let installed: ModelDeclaration[] = [];
  try { installed = await (deps.installed ?? installedFromRuntimes)(); } catch { installed = []; }
  const catalog = (deps.readCatalog ?? (() => readCatalog()))() ?? [];

  const byKey = new Map<string, ModelDeclaration>();
  for (const d of [...bootstrap, ...installed, ...catalog]) {
    const key = `${d.provider}::${d.model}`;
    if (!byKey.has(key)) byKey.set(key, d); // first wins: bootstrap > installed > catalog
  }
  return [...byKey.values()];
}
```
`src/discovery/discover.ts`:
```ts
import type { Capability } from '../core/types.ts';
import { runtimeFor } from '../runtime/registry.ts';
import { catalogPath, writeCatalog as writeCatalogFile } from './catalog-cache.ts';
import type { Candidate, CatalogSource, HostCapabilities } from './catalog-source.ts';
import { detectHost } from './host.ts';
import { SOURCES } from './sources.ts';
import { Capability as Cap } from '../core/types.ts';

export type DiscoverDeps = {
  host?: HostCapabilities;
  sources?: CatalogSource[];
  writeCatalog?: (c: Candidate[]) => void;
  pullTop?: (model: string, provider: Candidate['provider']) => Promise<void>;
  catalogPathStr?: string;
  prePullCount?: number;
};

export type DiscoverResult = { found: number; fits: number; pulled: string[]; path: string };

export async function runDiscovery(deps: DiscoverDeps = {}): Promise<DiscoverResult> {
  const host = deps.host ?? (await detectHost());
  const sources = (deps.sources ?? SOURCES).filter((s) => s.appliesTo(host));
  const requires: Capability[] = [Cap.Tools];

  const all: Candidate[] = [];
  for (const s of sources) {
    try { all.push(...await s.listCandidates({ budgetBytes: host.liveBudgetBytes, requires, hostTotalRamBytes: host.totalRamBytes })); }
    catch { /* degrade: skip a failing source */ }
  }
  // dedupe by (provider, base repo), keep highest downloads
  const byRepo = new Map<string, Candidate>();
  for (const c of all) {
    const key = `${c.provider}::${c.repo}`;
    const prev = byRepo.get(key);
    if (!prev || c.downloads > prev.downloads) byRepo.set(key, c);
  }
  const ranked = [...byRepo.values()].sort(
    (a, b) => b.downloads - a.downloads || b.footprint.approxParamsBillions - a.footprint.approxParamsBillions,
  );

  (deps.writeCatalog ?? ((c) => writeCatalogFile(c)))(ranked);

  const pulled: string[] = [];
  const n = deps.prePullCount ?? 1;
  const pull = deps.pullTop ?? (async (model, provider) => { await runtimeFor(provider).control.pull(model); });
  for (const c of ranked.slice(0, n)) {
    try { await pull(c.model, c.provider); pulled.push(c.model); } catch { /* report, don't fail */ }
  }
  return { found: all.length, fits: ranked.length, pulled, path: deps.catalogPathStr ?? catalogPath() };
}
```

- [ ] **Step 4: Run** — `bun test tests/discovery/` → PASS. `bun run typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/discovery/sources.ts src/discovery/build-registry.ts src/discovery/discover.ts tests/discovery/build-registry.test.ts tests/discovery/discover.test.ts
git commit -m "feat(discovery): discover pipeline + offline-safe registry builder"
```

---

### Task 11: `discover` CLI + chat wiring + registry rename

**Files:**
- Create: `src/cli/discover.ts`
- Modify: `models/registry.ts` (rename `REGISTRY` → `BOOTSTRAP`)
- Modify: `src/discovery/build-registry.ts` (import `BOOTSTRAP`)
- Modify: `src/cli/chat.ts` (use `await buildRegistry()`)
- Modify: `tests/models/registry.test.ts`, `tests/cli/select-hook.test.ts`, `tests/resource/select-degrade.test.ts`, `tests/integration/selection.live.test.ts` (rename import)
- Modify: `package.json` (add `discover` script)

**Interfaces:**
- Consumes: `runDiscovery`, `buildRegistry`, `createSelectHook`.
- Produces: `bun run discover`; `BOOTSTRAP` export; chat reads the merged registry.

- [ ] **Step 1: Rename the bootstrap export** — `models/registry.ts`
```ts
export const BOOTSTRAP: ModelDeclaration[] = [qwenRouter, qwenFast];
```
Update consumers (replace `REGISTRY` → `BOOTSTRAP` in the import + usages):
- `tests/models/registry.test.ts` (rename import + the two assertions' variable)
- `tests/cli/select-hook.test.ts`, `tests/resource/select-degrade.test.ts`, `tests/integration/selection.live.test.ts`
- `src/discovery/build-registry.ts` (`import { BOOTSTRAP } from '../../models/registry.ts'` and use it)

- [ ] **Step 2: Wire chat to the merged registry** — `src/cli/chat.ts`

Replace the `REGISTRY` import with the builder, and build the registry once at startup:
```ts
import { buildRegistry } from '../discovery/build-registry.ts';
```
Replace `registry: REGISTRY,` in the `createSelectHook` call with a value computed just above it:
```ts
  const registry = await buildRegistry();
  const onBeforeDelegate = createSelectHook({
    registry,
    ensureReady: (decl, opts) => manager.ensureReady(decl, opts),
    listLoaded: () => listLoadedModels(),
    pinned: [qwenRouter.model],
    capture,
    onAttempt: notify,
  });
```
(Keep everything else in `chat.ts` unchanged.)

- [ ] **Step 3: Create the `discover` command** — `src/cli/discover.ts`
```ts
import { runDiscovery } from '../discovery/discover.ts';

async function main(): Promise<void> {
  console.error('Discovering models from Hugging Face (this needs internet)...');
  try {
    const r = await runDiscovery();
    console.error(
      `Found ${r.found} candidate(s), ${r.fits} fit the budget. ` +
      `Pre-pulled: ${r.pulled.length ? r.pulled.join(', ') : 'none'}. Catalog: ${r.path}`,
    );
  } catch (err) {
    console.error(`Discovery failed (using any existing catalog): ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
main();
```
Add to `package.json` scripts: `"discover": "bun run src/cli/discover.ts"`.

- [ ] **Step 4: Run the full suite** — `bun test` → all unit tests PASS (live auto-skip). `bun run typecheck` → clean. `bun run lint` → exit 0.

- [ ] **Step 5: Commit**
```bash
git add models/registry.ts src/discovery/build-registry.ts src/cli/chat.ts src/cli/discover.ts package.json tests/
git commit -m "feat(cli): discover command + chat reads merged registry (REGISTRY->BOOTSTRAP)"
```

---

### Task 12: Live verification + documentation

**Files:**
- Create: `tests/integration/discover.live.test.ts`, `tests/integration/mlx.live.test.ts`
- Modify: `README.md`, `docs/architecture.md`, `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `runDiscovery`, `mlxServerRuntime`, `ollamaReady` helper pattern.

- [ ] **Step 1: Live discovery test** — `tests/integration/discover.live.test.ts`
```ts
import { describe, expect, test } from 'bun:test';

async function online(): Promise<boolean> {
  try { return (await fetch('https://huggingface.co/api/models?filter=gguf&limit=1', { signal: AbortSignal.timeout(3000) })).ok; }
  catch { return false; }
}
const ready = await online();

describe.skipIf(!ready)('live HF discovery', () => {
  test('returns ≥1 tool-capable GGUF candidate that fits', async () => {
    const { runDiscovery } = await import('../../src/discovery/discover.ts');
    let written = 0;
    const r = await runDiscovery({
      host: { totalRamBytes: 24e9, liveBudgetBytes: 12e9, runtimes: [] as never[] },
      writeCatalog: (c) => { written = c.length; },
      pullTop: async () => {}, // don't actually pull multi-GB in a test
      prePullCount: 0,
    });
    expect(r.fits).toBeGreaterThan(0);
    expect(written).toBeGreaterThan(0);
  }, 60_000);
});
```

- [ ] **Step 2: MLX live test** — `tests/integration/mlx.live.test.ts`
```ts
import { describe, expect, test } from 'bun:test';
import { mlxServerRuntime } from '../../src/runtime/mlx-server.ts';

const ready = await mlxServerRuntime.isAvailable();

describe.skipIf(!ready)('live MLX server', () => {
  test('lists at least one loaded model', async () => {
    const loaded = await mlxServerRuntime.control.listLoaded();
    expect(Array.isArray(loaded)).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 3: Run live tests (best-effort)** — `bun test tests/integration/` → discover.live PASS if online (else skip); mlx.live skips unless an MLX server is up; existing Ollama live tests still green.

- [ ] **Step 4: Update README** — add a "Model discovery (Slice 6)" paragraph:
> **Model discovery (Slice 6).** `bun run discover` fetches the latest tool-capable GGUF models from Hugging Face (trusted publishers, sized to your live RAM budget), writes a per-machine `model-images/catalog.json`, and pre-pulls the top fitting model. Normal `chat` runs read an **offline** merge of the bootstrap rungs + locally-installed models + the cached catalog — no network needed. A local MLX server (LM Studio / vllm-mlx at `MLX_BASE_URL`) is discovered + used automatically when running. Vision/audio/video and an uncensored mode are typed-in seams shipped in later slices.

Update the README roadmap table: Slice 6 → Done; show Slice 7 (KV-cache quant) as next.

- [ ] **Step 5: Update architecture.md** — add a "Discovery & runtimes (Slice 6)" section describing the `Runtime` port (Ollama + MLX-server), the `CatalogSource` port (hf-gguf + hf-mlx), the host detector, the offline `buildRegistry` merge, and the `discover` pipeline + pre-pull. Note the four axes (capability/modality, runtime, source, content-policy).

- [ ] **Step 6: Update ROADMAP.md** — move Slice 6 into Shipped; list the committed follow-ons: **Slice 7 KV-cache quant** (q8_0 default, q4_0 opt-in w/ high-GQA guard, global `OLLAMA_KV_CACHE_TYPE`+`OLLAMA_FLASH_ATTENTION`), **Slice 8 Vision**, **Slice 9 Audio**, **Slice 10 Video**, **Slice 11 Uncensored mode**, plus Ollama-native-MLX-on-Mac-Mini and BFCL offline ranking. Reference spec §11.

- [ ] **Step 7: Typecheck + full suite** — `bun run typecheck && bun run lint && bun test` → clean / exit 0 / green (live pass-or-skip).

- [ ] **Step 8: Commit**
```bash
git add tests/integration/discover.live.test.ts tests/integration/mlx.live.test.ts README.md docs/architecture.md docs/ROADMAP.md
git commit -m "test(discovery): live discover + MLX verify + Slice 6 docs"
```

---

## Final review (whole-branch)

- [ ] `bun run typecheck` · `bun run lint` · `bun test` (note pass/skip counts).
- [ ] Dispatch code-review subagents across dimensions (correctness, types, silent-failures, offline-safety, tests). Pay special attention to: the manager runtime-routing refactor (no Ollama regression), offline degradation never throwing on the chat path, and the HF parsing robustness.
- [ ] Apply verified Critical/Important findings; triage Minors.

---

## Self-review (plan vs spec)

**Spec coverage:**
- §2 four-axis taxonomy → Task 1 (capability/runtime/content-policy enums + filter). ✓
- §3 runtime registry (Ollama + MLX) + manager refactor → Tasks 2, 3, 4. ✓
- §4 catalog sources (GGUF + MLX) + quant + hf-client → Tasks 5, 6, 7, 8. ✓
- §5 host detector + cache + discover pipeline + build-registry + CLI → Tasks 9, 10, 11. ✓
- §6 data flow (discover online; chat offline merge) → Tasks 10, 11. ✓
- §7 offline error handling → Tasks 6 (hf-client wraps), 10/11 (degrade), build-registry offline test (Task 10). ✓
- §9 testing (unit + live discover + live mlx) → every task + Task 12. ✓
- §11 future work → ROADMAP at Task 12 Step 6. ✓

**Placeholder scan:** every code step has complete code; commands have expected output; no TBD/TODO. (Task 8's fetch-stub note offers a concrete simplification, not a placeholder.) ✓

**Type consistency:** `Runtime`/`RuntimeControl`/`runtimeFor`/`availableRuntimes`, `Candidate`/`CatalogSource`/`DiscoveryQuery`/`HostCapabilities`, `hfGet`, `bytesPerWeightForQuant`/`pickBestQuantThatFits`/`QuantFile`, `buildRegistry`/`runDiscovery`/`SOURCES`, `BOOTSTRAP` — names consistent across tasks. Manager `ManagerDeps` new shape (`controlFor`) used consistently in Task 4. `BOOTSTRAP` rename consumers all listed in Task 11. ✓
