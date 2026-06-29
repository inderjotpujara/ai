# Dynamic Context Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Size each model's `num_ctx` dynamically from the live free-RAM headroom, capped by the model's live-detected max context, and actually pass it to Ollama at both warm and inference.

**Architecture:** The Model Manager is the single source of truth: in `ensureReady` it splits footprint into weights + KV-per-token, fits the model at a `MIN_CTX` floor (reusing the best-effort headroom loop), scales the context up to a budget-clamped `chosenCtx` (clamped by a live `/api/show` context_length probe), warms at that ctx, and returns it. The chosen ctx flows to inference via the `onBeforeDelegate` hook → `providerOptions.ollama.options.num_ctx`, keeping `core/` decoupled from `resource/`.

**Tech Stack:** TypeScript, Bun, Vercel AI SDK 6 (`ai@^6`), `ollama-ai-provider-v2@^3`, Ollama HTTP API, `bun test` with `MockLanguageModelV3` from `ai/test`, Biome.

**Spec:** `docs/superpowers/specs/2026-06-29-dynamic-context-sizing-design.md`
**Branch:** `dynamic-context-sizing`, stacked on `fix-live-memory-budget`.

## Global Constraints

- Use `bun`, never `npm`. Typecheck `bun run typecheck`; tests `bun test`; lint `bun run lint`.
- Pins (do not bump): `ai@^6`, `ollama-ai-provider-v2@^3`, `zod@^4`. Lint = Biome.
- Biome: use `execute?.` not `execute!` (noNonNullAssertion); run `bunx biome check --write <files>` before each commit to fix import order/format.
- Code style: `type` over `interface`; string `enum` for finite sets; early returns; small focused files; descriptive names.
- `num_ctx` for inference goes at `providerOptions.ollama.options.num_ctx` (nested `options`), NOT `providerOptions.ollama.num_ctx`.
- Warm and inference `num_ctx` MUST be the same value (sourced from `chosenCtx`) or Ollama reloads the runner. Ollama's default ctx is 4096.
- `MIN_CTX = 4096`; chosen ctx rounded DOWN to a multiple of 1024.

---

### Task 1: Split footprint into weights + KV-per-token

**Files:**
- Modify: `src/resource/footprint.ts`
- Test: `tests/resource/footprint.test.ts`

**Interfaces:**
- Produces: `weightsBytes(paramsBillions: number, bytesPerWeight: number): number`; `kvCacheBytes(contextTokens: number, kvBytesPerToken: number): number`. `estimateModelBytes(input)` unchanged (now `= weightsBytes(...) + kvCacheBytes(...)`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/resource/footprint.test.ts`:

```typescript
import { kvCacheBytes, weightsBytes } from '../../src/resource/footprint.ts';

test('weightsBytes applies the 1.2 runtime overhead', () => {
  expect(weightsBytes(1, 1)).toBe(1.2e9);
  expect(weightsBytes(4, 0.56)).toBe(4 * 1e9 * 0.56 * 1.2);
});

test('kvCacheBytes is contextTokens times bytes-per-token', () => {
  expect(kvCacheBytes(4096, 131072)).toBe(4096 * 131072);
  expect(kvCacheBytes(0, 131072)).toBe(0);
});
```

(Keep the existing `estimateModelBytes` test in the file unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/resource/footprint.test.ts`
Expected: FAIL — `weightsBytes`/`kvCacheBytes` not exported.

- [ ] **Step 3: Implement the split**

Replace the body of `src/resource/footprint.ts` below the `FootprintInput` type:

```typescript
const RUNTIME_OVERHEAD = 1.2;

/** Resident bytes of the weights (quantized) plus runtime overhead — no KV cache. */
export function weightsBytes(
  paramsBillions: number,
  bytesPerWeight: number,
): number {
  return paramsBillions * 1e9 * bytesPerWeight * RUNTIME_OVERHEAD;
}

/** KV-cache bytes for a given context window. */
export function kvCacheBytes(
  contextTokens: number,
  kvBytesPerToken: number,
): number {
  return contextTokens * kvBytesPerToken;
}

/**
 * Estimate the RAM a model needs before loading it.
 * weights (with overhead) plus a KV-cache term that grows with context.
 */
export function estimateModelBytes(input: FootprintInput): number {
  return (
    weightsBytes(input.paramsBillions, input.bytesPerWeight) +
    kvCacheBytes(input.contextTokens, input.kvBytesPerToken)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/resource/footprint.test.ts`
Expected: PASS (all, including the existing estimate test).

- [ ] **Step 5: Lint + commit**

```bash
bunx biome check --write src/resource/footprint.ts tests/resource/footprint.test.ts
bun run typecheck
git add src/resource/footprint.ts tests/resource/footprint.test.ts
git commit -m "refactor(resource): expose weights/kv split in footprint"
```

---

### Task 2: Ollama control — `num_ctx` on warm + live max-context probe

**Files:**
- Modify: `src/resource/ollama-control.ts`
- Test: `tests/resource/ollama-control.test.ts` (create)

**Interfaces:**
- Produces: `warmModel(model: string, numCtx?: number, baseUrl?: string): Promise<void>` (numCtx inserted as `options.num_ctx`); `getModelMaxContext(model: string, baseUrl?: string): Promise<number | undefined>`.
- Note: `warmModel`'s second positional arg becomes `numCtx`; callers passing a custom `baseUrl` must now pass it third. (The only non-test caller is the manager via `d.warm`, updated in Task 3.)

- [ ] **Step 1: Write the failing tests**

Create `tests/resource/ollama-control.test.ts`:

```typescript
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import {
  getModelMaxContext,
  warmModel,
} from '../../src/resource/ollama-control.ts';

const realFetch = globalThis.fetch;
let lastBody: Record<string, unknown> | undefined;

function stubFetch(json: unknown, ok = true): void {
  globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : undefined;
    return new Response(JSON.stringify(json), { status: ok ? 200 : 500 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  lastBody = undefined;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('warmModel includes options.num_ctx when a context is given', async () => {
  stubFetch({});
  await warmModel('m', 8192);
  expect(lastBody).toMatchObject({ model: 'm', stream: false });
  expect((lastBody?.options as { num_ctx: number }).num_ctx).toBe(8192);
});

test('warmModel omits options when no context is given', async () => {
  stubFetch({});
  await warmModel('m');
  expect(lastBody?.options).toBeUndefined();
});

test('getModelMaxContext reads model_info architecture context_length', async () => {
  stubFetch({
    model_info: {
      'general.architecture': 'qwen35',
      'qwen35.context_length': 262144,
    },
  });
  expect(await getModelMaxContext('qwen3.5:4b')).toBe(262144);
});

test('getModelMaxContext returns undefined when the field is absent', async () => {
  stubFetch({ model_info: { 'general.architecture': 'qwen35' } });
  expect(await getModelMaxContext('qwen3.5:4b')).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/resource/ollama-control.test.ts`
Expected: FAIL — `getModelMaxContext` not exported; `warmModel` ignores num_ctx.

- [ ] **Step 3: Implement**

In `src/resource/ollama-control.ts`, replace `warmModel` and add `getModelMaxContext` + the `ShowResponse` type (place `ShowResponse` near the other response types at the top):

```typescript
type ShowResponse = { model_info?: Record<string, unknown> };
```

```typescript
/** Warm/preload a model into memory, optionally reserving a context window. */
export function warmModel(
  model: string,
  numCtx?: number,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  const body: Record<string, unknown> = { model, stream: false };
  if (numCtx !== undefined) body.options = { num_ctx: numCtx };
  return postJson(baseUrl, '/api/generate', body);
}

/**
 * The model's true maximum context window, read live from `POST /api/show`
 * (`model_info["<arch>.context_length"]`). Returns undefined if not reported.
 */
export async function getModelMaxContext(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<number | undefined> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    });
  } catch (cause) {
    throw new ProviderError('Ollama /api/show failed', { cause });
  }
  if (!res.ok) {
    throw new ProviderError(`Ollama /api/show returned ${res.status}`);
  }
  const data = (await res.json()) as ShowResponse;
  const info = data.model_info ?? {};
  const arch = info['general.architecture'];
  if (typeof arch !== 'string') return undefined;
  const ctx = info[`${arch}.context_length`];
  return typeof ctx === 'number' ? ctx : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/resource/ollama-control.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + typecheck + commit**

```bash
bunx biome check --write src/resource/ollama-control.ts tests/resource/ollama-control.test.ts
bun run typecheck
git add src/resource/ollama-control.ts tests/resource/ollama-control.test.ts
git commit -m "feat(resource): warm with num_ctx + live getModelMaxContext probe"
```

---

### Task 3: Model manager computes & returns the budget-clamped context

**Files:**
- Modify: `src/core/types.ts` (add `maxContext`, `kvBytesPerToken`)
- Modify: `src/resource/model-manager.ts`
- Test: `tests/resource/model-manager.test.ts`

**Interfaces:**
- Consumes: `weightsBytes`, `kvCacheBytes` (Task 1); `getModelMaxContext` (Task 2).
- Produces: `ensureReady(decl, opts?): Promise<number>` (returns the chosen `num_ctx`); `ManagerDeps.getModelMax: (model: string) => Promise<number | undefined>`; exported `const MIN_CTX = 4096`.

- [ ] **Step 1: Extend the type**

In `src/core/types.ts`, replace the `ModelDeclaration` type:

```typescript
export type ModelDeclaration = {
  provider: ProviderKind;
  model: string;
  params: ModelParams;
  role: string;
  /** Pre-load sizing hint for the model manager. */
  footprint: {
    approxParamsBillions: number;
    bytesPerWeight: number;
    /** Bytes of KV cache per token (per-model; defaults to 131072 if omitted). */
    kvBytesPerToken?: number;
  };
  /**
   * Optional cap on the context window. The true max is detected live from
   * Ollama; set this only to deliberately cap below it or as a probe fallback.
   */
  maxContext?: number;
};
```

- [ ] **Step 2: Write the failing tests**

In `tests/resource/model-manager.test.ts`, update `fakes()` to add a `getModelMax` default, and add the new tests. First add to the `fakes()` return object (after `warn:`):

```typescript
    getModelMax: mock(async () => 262144),
```

Then update the `decl` helper to allow a desired context and append new tests:

```typescript
function declCtx(model: string, b: number, numCtx: number): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: { numCtx },
    role: 'test',
    footprint: { approxParamsBillions: b, bytesPerWeight: 1 },
  };
}

test('ample headroom: chosenCtx is the desired value, warmed at it', async () => {
  const f = fakes();
  const mgr = createModelManager({ budgetBytes: 100e9, ...f });
  const ctx = await mgr.ensureReady(declCtx('m1', 1, 16384));
  expect(ctx).toBe(16384);
  expect(f.warm).toHaveBeenCalledWith('m1', 16384);
});

test('tight headroom: chosenCtx shrinks to fit, floored & rounded to 1024', async () => {
  // weights(1,1)=1.2e9; kv/token=131072. budget chosen so maxCtxByFit == 8192:
  // headroom-weights = 8192*131072 = 1073741824 → budget = 1073741824 + 1.2e9.
  const f = fakes();
  const mgr = createModelManager({ budgetBytes: 1073741824 + 1.2e9, ...f });
  const ctx = await mgr.ensureReady(declCtx('m1', 1, 16384));
  expect(ctx).toBe(8192);
  expect(ctx % 1024).toBe(0);
  expect(f.warm).toHaveBeenCalledWith('m1', 8192);
});

test('chosenCtx is capped by the live-probed model max', async () => {
  const f = fakes({ getModelMax: mock(async () => 6144) });
  const mgr = createModelManager({ budgetBytes: 100e9, ...f });
  const ctx = await mgr.ensureReady(declCtx('m1', 1, 16384));
  expect(ctx).toBe(6144);
});

test('probe failure falls back to decl.maxContext', async () => {
  const f = fakes({
    getModelMax: mock(async () => {
      throw new Error('no show');
    }),
  });
  const mgr = createModelManager({ budgetBytes: 100e9, ...f });
  const decl = { ...declCtx('m1', 1, 16384), maxContext: 5120 };
  const ctx = await mgr.ensureReady(decl);
  expect(ctx).toBe(5120);
  expect(f.getModelMax).toHaveBeenCalled();
});

test('cannot fit even the MIN_CTX floor: throws, warms nothing', async () => {
  // minNeed = weights(1,1)=1.2e9 + 4096*131072 ≈ 1.737e9; budget 1e9 < minNeed, nothing to evict.
  const f = fakes();
  const mgr = createModelManager({ budgetBytes: 1e9, ...f });
  await expect(mgr.ensureReady(declCtx('big', 1, 16384))).rejects.toBeInstanceOf(
    ResourceError,
  );
  expect(f.warm).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/resource/model-manager.test.ts`
Expected: FAIL — `getModelMax` not a dep; `ensureReady` returns void; warm called with one arg.

- [ ] **Step 4: Implement the manager changes**

In `src/resource/model-manager.ts`:

(a) Update imports — replace the footprint import and add control import:

```typescript
import { kvCacheBytes, weightsBytes } from './footprint.ts';
import {
  getModelMaxContext,
  isModelInstalled,
  type LoadedModel,
  listLoadedModels,
  pullModel,
  unloadModel,
  warmModel,
} from './ollama-control.ts';
```

(Remove the old `import { estimateModelBytes } from './footprint.ts';` and the now-unused `declBytes` if nothing else uses it — keep `declBytes` only if other code imports it; the live test does not. Delete `declBytes` and its `estimateModelBytes` use.)

(b) Add constants after the imports:

```typescript
export const MIN_CTX = 4096;
const DEFAULT_KV_PER_TOKEN = 131072;
const CTX_ROUNDING = 1024;
```

(c) Add `getModelMax` to `ManagerDeps` (after `warn`):

```typescript
  getModelMax: (model: string) => Promise<number | undefined>;
```

(d) Add to `defaultDeps()` return (after `warn:`):

```typescript
    getModelMax: (m) => getModelMaxContext(m),
```

(e) Replace the entire `ensureReady` function body with the context-aware version. Inside `createModelManager`, keep `lastUsed`/`tick` and add two memo maps:

```typescript
  const lastUsed = new Map<string, number>();
  const chosenCtxByModel = new Map<string, number>();
  const maxCtxByModel = new Map<string, number>();
  let tick = 0;

  async function modelMaxFor(model: string): Promise<number | undefined> {
    const cached = maxCtxByModel.get(model);
    if (cached !== undefined) return cached;
    let probed: number | undefined;
    try {
      probed = await d.getModelMax(model);
    } catch {
      probed = undefined;
    }
    if (probed !== undefined) maxCtxByModel.set(model, probed);
    return probed;
  }

  async function ensureReady(
    decl: ModelDeclaration,
    opts: EnsureOpts = {},
  ): Promise<number> {
    const pinned = new Set(opts.pinned ?? []);
    const target = decl.model;
    const desired = decl.params.numCtx ?? MIN_CTX;

    if (!(await d.isInstalled(target))) await d.pull(target);

    let loaded = await d.listLoaded();
    if (loaded.some((m) => m.name === target)) {
      lastUsed.set(target, ++tick);
      return chosenCtxByModel.get(target) ?? desired;
    }

    const weights = weightsBytes(
      decl.footprint.approxParamsBillions,
      decl.footprint.bytesPerWeight,
    );
    const kvPerToken = decl.footprint.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN;
    const minNeed = weights + kvCacheBytes(MIN_CTX, kvPerToken);
    const freeBudget = await resolveBudget(d.budgetBytes);
    const gb = (bytes: number) => Math.round(bytes / 1e9);

    const lru = (a: LoadedModel, b: LoadedModel) =>
      (lastUsed.get(a.name) ?? -1) - (lastUsed.get(b.name) ?? -1);

    // Fit the model at its minimum context; evicting returns real bytes to headroom.
    let headroom = freeBudget;
    while (minNeed > headroom) {
      const evictable = loaded.filter((m) => m.name !== target);
      const nonPinned = evictable.filter((m) => !pinned.has(m.name)).sort(lru);
      const evict = nonPinned[0] ?? evictable.sort(lru)[0];
      if (evict === undefined) {
        throw new ResourceError(
          `Cannot load ${target} (needs ~${gb(minNeed)}GB at min context): it exceeds the live memory budget (~${gb(freeBudget)}GB) even after evicting every other model.`,
        );
      }
      if (pinned.has(evict.name)) {
        d.warn(
          `[model-manager] live memory budget (~${gb(freeBudget)}GB) too low to keep ${evict.name} pinned; evicting it to load ${target} (best-effort pin — it will reload on demand).`,
        );
      }
      await d.unload(evict.name);
      lastUsed.delete(evict.name);
      chosenCtxByModel.delete(evict.name);
      headroom += evict.sizeBytes;
      loaded = loaded.filter((m) => m.name !== evict.name);
    }

    // Scale context up into the remaining headroom, clamped by the live model max.
    const probedMax = await modelMaxFor(target);
    const ceiling = Math.min(
      decl.maxContext ?? Number.POSITIVE_INFINITY,
      probedMax ?? Number.POSITIVE_INFINITY,
    );
    const maxCtxByFit = Math.floor((headroom - weights) / kvPerToken);
    let chosenCtx = Math.min(desired, ceiling, maxCtxByFit);
    chosenCtx = Math.max(MIN_CTX, chosenCtx);
    chosenCtx -= chosenCtx % CTX_ROUNDING;
    chosenCtx = Math.max(MIN_CTX, chosenCtx);

    await d.warm(target, chosenCtx);
    lastUsed.set(target, ++tick);
    chosenCtxByModel.set(target, chosenCtx);
    return chosenCtx;
  }
```

(f) In `unloadAll`, also clear the ctx memo:

```typescript
  async function unloadAll(): Promise<void> {
    for (const model of [...lastUsed.keys()]) {
      await d.unload(model);
    }
    lastUsed.clear();
    chosenCtxByModel.clear();
  }
```

(g) Update `d.unload`/`d.warm` dep types: `ManagerDeps.warm` becomes `(model: string, numCtx?: number) => Promise<void>`. Update `defaultDeps` `warm: (m, n) => warmModel(m, n)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/resource/model-manager.test.ts`
Expected: PASS — all prior tests (which use `budgetBytes` as free headroom) still pass, plus the 5 new ones.

- [ ] **Step 6: Lint + typecheck + commit**

```bash
bunx biome check --write src/core/types.ts src/resource/model-manager.ts tests/resource/model-manager.test.ts
bun run typecheck
git add src/core/types.ts src/resource/model-manager.ts tests/resource/model-manager.test.ts
git commit -m "feat(resource): budget-clamped dynamic context, live max via /api/show"
```

---

### Task 4: Thread the chosen context into agent inference

**Files:**
- Modify: `src/core/agent-def.ts` (add `ollamaCtxOptions`, `runDefinedAgent` numCtx param)
- Modify: `src/core/delegate.ts` (`BeforeDelegate` returns `{ numCtx? }`)
- Modify: `src/core/orchestrator.ts` (`runOrchestrator` numCtx param)
- Test: `tests/core/agent-def.test.ts` (create)

**Interfaces:**
- Produces: `ollamaCtxOptions(numCtx?: number): ProviderOptions | undefined`; `runDefinedAgent(agent, task, numCtx?)`; `BeforeDelegate = (agent: Agent) => Promise<{ numCtx?: number } | void>`; `runOrchestrator(orchestrator, task, numCtx?)`.

- [ ] **Step 1: Write the failing test**

Create `tests/core/agent-def.test.ts`:

```typescript
import { expect, test } from 'bun:test';
import { ollamaCtxOptions } from '../../src/core/agent-def.ts';

test('ollamaCtxOptions nests num_ctx under ollama.options', () => {
  expect(ollamaCtxOptions(8192)).toEqual({
    ollama: { options: { num_ctx: 8192 } },
  });
});

test('ollamaCtxOptions returns undefined when no context is given', () => {
  expect(ollamaCtxOptions()).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/agent-def.test.ts`
Expected: FAIL — `ollamaCtxOptions` not exported.

- [ ] **Step 3: Implement `agent-def.ts`**

Replace `src/core/agent-def.ts` contents below the `Agent` type:

```typescript
import type { ProviderOptions } from '@ai-sdk/provider-utils';
```

(add that import at the top with the others), and replace `runDefinedAgent`:

```typescript
/** Build provider options that set Ollama's context window for this call. */
export function ollamaCtxOptions(numCtx?: number): ProviderOptions | undefined {
  return numCtx === undefined
    ? undefined
    : { ollama: { options: { num_ctx: numCtx } } };
}

/** Run an agent definition against a task, optionally at a chosen context size. */
export function runDefinedAgent(
  agent: Agent,
  task: string,
  numCtx?: number,
): ReturnType<typeof runAgent> {
  return runAgent({
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    prompt: task,
    tools: agent.tools,
    providerOptions: ollamaCtxOptions(numCtx),
  });
}
```

- [ ] **Step 4: Update `delegate.ts`**

Change the `BeforeDelegate` type and the `execute` body:

```typescript
/** A hook run just before a delegated agent executes; may return a chosen context size. */
export type BeforeDelegate = (
  agent: Agent,
) => Promise<{ numCtx?: number } | void>;
```

```typescript
    execute: async ({ task }) => {
      try {
        const pre = onBeforeDelegate ? await onBeforeDelegate(agent) : undefined;
        const { text } = await runDefinedAgent(agent, task, pre?.numCtx);
        return { text };
      } catch (cause) {
        return {
          error: `Agent ${agent.name} failed: ${(cause as Error).message}`,
        };
      }
    },
```

- [ ] **Step 5: Update `orchestrator.ts`**

Add a `numCtx` parameter to `runOrchestrator` and pass it to both `runDefinedAgent` calls:

```typescript
export async function runOrchestrator(
  orchestrator: Agent,
  task: string,
  numCtx?: number,
): Promise<OrchestratorResult> {
```

```typescript
    const result = await runDefinedAgent(orchestrator, task, numCtx);
```

(There is only one `runDefinedAgent` call in `runOrchestrator`; the gap path reads `err.steps`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/core/agent-def.test.ts && bun test tests/core/`
Expected: PASS — new helper tests pass; existing orchestrator/delegate tests still pass (the `void`-returning hooks remain valid; `numCtx` is optional).

- [ ] **Step 7: Lint + typecheck + commit**

```bash
bunx biome check --write src/core/agent-def.ts src/core/delegate.ts src/core/orchestrator.ts tests/core/agent-def.test.ts
bun run typecheck
git add src/core/agent-def.ts src/core/delegate.ts src/core/orchestrator.ts tests/core/agent-def.test.ts
git commit -m "feat(core): thread chosen num_ctx through delegation to inference"
```

---

### Task 5: Declare desired context per role

**Files:**
- Modify: `models/qwen-router.ts`, `models/qwen-fast.ts`

**Interfaces:**
- Consumes: `ModelDeclaration` with optional `maxContext` (Task 3). No new exports.

- [ ] **Step 1: Update the specialist's desired context**

In `models/qwen-fast.ts`, change the params line to a larger desired window (specialists handle documents) and add a clarifying comment:

```typescript
  // Desired context for the role; the true max is detected live from Ollama
  // and the manager clamps this down under memory pressure.
  params: { temperature: 0.2, numCtx: 16384 },
```

In `models/qwen-router.ts`, keep `numCtx: 8192` and add the same one-line comment above `params`.

- [ ] **Step 2: Typecheck + verify the suite still green**

Run: `bun run typecheck && bun test tests/resource/`
Expected: PASS.

- [ ] **Step 3: Lint + commit**

```bash
bunx biome check --write models/qwen-router.ts models/qwen-fast.ts
git add models/qwen-router.ts models/qwen-fast.ts
git commit -m "feat(models): declare per-role desired context (router 8192, specialist 16384)"
```

---

### Task 6: Wire the chosen context through the CLI

**Files:**
- Modify: `src/cli/run-chat.ts` (`ChatDeps.routerNumCtx`, pass to `runOrchestrator`)
- Modify: `src/cli/chat.ts` (use `ensureReady` return; hook returns `{ numCtx }`)
- Test: `tests/` existing run-chat test stays green (no signature break — field is optional)

**Interfaces:**
- Consumes: `runOrchestrator(orchestrator, task, numCtx?)` (Task 4); `ensureReady` returns `number` (Task 3).

- [ ] **Step 1: Update `run-chat.ts`**

Add the optional field and pass it through:

```typescript
export type ChatDeps = {
  orchestrator: Agent;
  task: string;
  runsRoot: string;
  runId: string;
  routerNumCtx?: number;
};
```

```typescript
  const result = await runOrchestrator(
    deps.orchestrator,
    deps.task,
    deps.routerNumCtx,
  );
```

- [ ] **Step 2: Update `chat.ts`**

Capture the router's chosen ctx and make the hook return the specialist's:

```typescript
  const routerNumCtx = await manager.ensureReady(qwenRouter, {
    pinned: [qwenRouter.model],
  });
```

```typescript
  // Specialists' models are loaded on demand at a budget-clamped context size,
  // keeping the router pinned-resident.
  const onBeforeDelegate = async (agent: {
    modelDecl?: import('../core/types.ts').ModelDeclaration;
  }): Promise<{ numCtx?: number }> =>
    agent.modelDecl
      ? { numCtx: await manager.ensureReady(agent.modelDecl, { pinned: [qwenRouter.model] }) }
      : {};
```

And pass `routerNumCtx` into `runChat`:

```typescript
      const result = await runChat({
        orchestrator,
        task,
        runsRoot: 'runs',
        runId: `run-${process.pid}`,
        routerNumCtx,
      });
```

(Remove the now-redundant standalone `await manager.ensureReady(qwenRouter, ...)` line that previously preceded the project-store notice — it is replaced by the `routerNumCtx` assignment above; keep the `console.error` notice after it.)

- [ ] **Step 3: Typecheck + full suite**

Run: `bun run typecheck && bun test`
Expected: PASS (live tests auto-skip without Ollama).

- [ ] **Step 4: Lint + commit**

```bash
bunx biome check --write src/cli/run-chat.ts src/cli/chat.ts
bun run typecheck
git add src/cli/run-chat.ts src/cli/chat.ts
git commit -m "feat(cli): apply router + specialist chosen num_ctx at inference"
```

---

### Task 7: Live verification — context applied & shrinks under pressure

**Files:**
- Modify: `tests/integration/model-manager.live.test.ts` (add a context assertion)

**Interfaces:**
- Consumes: `ensureReady` returns chosen ctx; `getModelMaxContext` (Task 2).

- [ ] **Step 1: Add a live test for the chosen context**

Append a test inside the existing `describe.skipIf(!ready)` block in `tests/integration/model-manager.live.test.ts`:

```typescript
  test('ensureReady returns a sane chosen context within the model max', async () => {
    const max = await getModelMaxContext(qwenFast.model);
    const ctx = await manager.ensureReady(qwenFast, {
      pinned: [qwenRouter.model],
    });
    expect(ctx).toBeGreaterThanOrEqual(4096);
    expect(ctx % 1024).toBe(0);
    if (max !== undefined) expect(ctx).toBeLessThanOrEqual(max);
  }, 180_000);
```

Add the import at the top:

```typescript
import { getModelMaxContext } from '../../src/resource/ollama-control.ts';
```

(If `listLoadedModels` is already imported from that module, add `getModelMaxContext` to the same import.)

- [ ] **Step 2: Run the live test with Ollama up**

Run (manual, with Ollama serving + models pulled):
```bash
bun run serve   # terminal 1 (quit menu-bar Ollama first)
bun test tests/integration/model-manager.live.test.ts   # terminal 2
```
Expected: PASS — chosen ctx ≥ 4096, multiple of 1024, ≤ model max (262144).

- [ ] **Step 3: Full suite, lint, commit**

```bash
bun run typecheck && bun run lint && bun test
git add tests/integration/model-manager.live.test.ts
git commit -m "test(resource): live-assert chosen context is sane and within model max"
```

---

## Self-Review

- **Spec coverage:** policy/clamp → Task 3; live max detection → Tasks 2+3; wire-through warm → Tasks 2+3; wire-through inference → Tasks 4+6; per-role desired → Task 5; footprint split → Task 1; forward-compat (probe + fallback) → Task 3 (`modelMaxFor`); tests → every task + Task 7 live. All spec sections mapped.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `ensureReady → Promise<number>` (Task 3) consumed by Task 6; `BeforeDelegate → Promise<{numCtx?}|void>` (Task 4) consumed by Task 6 hook; `warmModel(model, numCtx?, baseUrl?)` (Task 2) consumed by Task 3 `defaultDeps.warm`; `ollamaCtxOptions` (Task 4) consumed by `runDefinedAgent`; `getModelMaxContext` (Task 2) consumed by Tasks 3 + 7. Consistent.
