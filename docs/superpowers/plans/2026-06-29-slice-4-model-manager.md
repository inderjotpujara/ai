# Slice 4: Model Manager (multi-model, hardware-aware) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Model Manager that loads an agent's model when it runs, keeps the orchestrator's small model pinned-resident, and evicts non-pinned models to stay within the GPU budget — so agents can safely use different local models.

**Architecture:** `ensureReady(decl,{pinned})` is the one entry point: install→estimate footprint→read `/api/ps` resident set→evict LRU non-pinned to fit→warm; throws `ResourceError` if a model can't fit alongside pinned. The orchestrator runs a small pinned model (`qwen3:4b`); specialists (`qwen3:8b`) load on demand via an injected `onBeforeDelegate` hook (so `core/` stays decoupled from `resource/`).

**Tech Stack:** Bun + TypeScript + Vercel AI SDK 6 (`ai@^6`); Ollama HTTP (`/api/ps`, `/api/pull`, `/api/generate`). Tests: `bun test` with injected fakes + `MockLanguageModelV3`; opt-in live test auto-skips via `ollamaReady()`.

## Global Constraints

- Stack: Bun + TS, ESM. Pins unchanged: `ai@^6`, `@ai-sdk/mcp@^1`, `ollama-ai-provider-v2@^3`, `zod@^4`. No dependency bumps.
- Code style: `type` over `interface`; string enums; early returns; small single-responsibility files; plain code; **no `!` non-null assertions** (the project's `noUncheckedIndexedAccess` makes array access `T | undefined` — guard with `if (x === undefined)`, never `!`); typed errors.
- **Ollama HTTP:** base `http://localhost:11434`. `GET /api/ps` → `{ models: [{ name, size, ... }] }` (`size` is bytes resident). Write requests use `model`; `/api/tags` & `/api/ps` report `name`.
- **Footprint formula (verified):** `estimateModelBytes({ paramsBillions, bytesPerWeight, contextTokens, kvBytesPerToken })` = `paramsBillions*1e9*bytesPerWeight*1.2 + contextTokens*kvBytesPerToken`. Use `bytesPerWeight: 0.56` (Q4_K_M), `kvBytesPerToken: 131072`, `contextTokens: decl.params.numCtx ?? 8192`.
- **Models (current-gen, verified mid-2026):** orchestrator → `qwen3.5:4b` (small, pinned); specialists → `qwen3.5:9b`. Use **standard GGUF tags, NOT `-mlx`** — Ollama's MLX backend needs >32 GB unified memory; this 24 GB M4 Pro runs llama.cpp Metal, where the `-mlx` tags are bigger and don't engage the MLX engine. Budget ≈ `0.75 × totalmem` (~18 GB).
- **Verify-and-fallback (do this once, live):** before relying on the new tags, confirm `ollama pull qwen3.5:4b` / `qwen3.5:9b` succeed AND `ollama show <tag>` lists `tools` under Capabilities. If a tag is missing or lacks `tools`, fall back to the proven `qwen3:4b` / `qwen3:8b` in the declaration (one-line change; the mock suite is unaffected either way). Note: `ornith:9b` (DeepReinforce, June 2026) is a strong *coding* model but its native Ollama tool-calling is unconfirmed — reserve it for a future coding sub-agent, not the router/general path.
- **Nested-delegation rule:** the orchestrator's model is **pinned** and must never be evicted by `ensureReady`.
- Tests: `bun run test:file -- ./path`; `bun run typecheck`; `bun run lint` (biome.json NOTICE acceptable). Mock-model shape mirrors `tests/core/agent.test.ts`.
- git initialized; on branch `slice-4-model-manager`. Commit each task; no `git init`.

---

### Task 1: `listLoadedModels()` on the Ollama control client

**Files:**
- Modify: `src/resource/ollama-control.ts`
- Test: `tests/resource/ollama-control.test.ts`

**Interfaces:**
- Produces: `type LoadedModel = { name: string; sizeBytes: number }`; `listLoadedModels(baseUrl?): Promise<LoadedModel[]>` — `GET /api/ps`, maps `models[].name` + `models[].size`.

- [ ] **Step 1: Write the failing test** — append to `tests/resource/ollama-control.test.ts`:

```ts
import { listLoadedModels } from '../../src/resource/ollama-control.ts';

test('listLoadedModels maps /api/ps name + size to LoadedModel[]', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ models: [{ name: 'qwen3:8b', size: 6_000_000_000 }, { name: 'qwen3:4b', size: 3_500_000_000 }] }),
      { status: 200 },
    ),
  );
  const loaded = await listLoadedModels();
  expect(loaded).toEqual([
    { name: 'qwen3:8b', sizeBytes: 6_000_000_000 },
    { name: 'qwen3:4b', sizeBytes: 3_500_000_000 },
  ]);
  expect((fetchSpy.mock.calls[0] as [string])[0]).toBe('http://localhost:11434/api/ps');
});

test('listLoadedModels returns [] when nothing is loaded', async () => {
  spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ models: [] }), { status: 200 }),
  );
  expect(await listLoadedModels()).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/resource/ollama-control.test.ts`
Expected: FAIL — `listLoadedModels` not exported.

- [ ] **Step 3: Add to `src/resource/ollama-control.ts`** (after the existing exports; reuse the module's `DEFAULT_BASE_URL` and `ProviderError`):

```ts
/** A model currently resident in Ollama, with its memory footprint. */
export type LoadedModel = { name: string; sizeBytes: number };

type PsResponse = { models?: Array<{ name: string; size: number }> };

/** Models currently loaded in memory, from `GET /api/ps`. */
export async function listLoadedModels(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<LoadedModel[]> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/ps`);
  } catch (cause) {
    throw new ProviderError('Ollama /api/ps failed', { cause });
  }
  if (!res.ok) throw new ProviderError(`Ollama /api/ps returned ${res.status}`);
  const data = (await res.json()) as PsResponse;
  return (data.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- ./tests/resource/ollama-control.test.ts` then `bun run typecheck`
Expected: PASS (existing + 2 new); typecheck 0.

- [ ] **Step 5: Commit**

```bash
git add src/resource/ollama-control.ts tests/resource/ollama-control.test.ts
git commit -m "feat(resource): add listLoadedModels (GET /api/ps)"
```

---

### Task 2: `ModelDeclaration` footprint hint + model declarations

**Files:**
- Modify: `src/core/types.ts`
- Modify: `models/qwen-fast.ts`
- Create: `models/qwen-router.ts`
- Test: `tests/models/declarations.test.ts`

**Interfaces:**
- Produces: `ModelDeclaration` gains `footprint: { approxParamsBillions: number; bytesPerWeight: number }`. `models/qwen-router.ts` default-exports a `ModelDeclaration` for `qwen3:4b`. `qwen-fast.ts` gains its footprint.

- [ ] **Step 1: Write the failing test** — `tests/models/declarations.test.ts`:

```ts
import { expect, test } from 'bun:test';
import qwenFast from '../../models/qwen-fast.ts';
import qwenRouter from '../../models/qwen-router.ts';

test('qwen-fast is qwen3.5:9b with a ~9B footprint', () => {
  expect(qwenFast.model).toBe('qwen3.5:9b');
  expect(qwenFast.footprint.approxParamsBillions).toBe(9);
  expect(qwenFast.footprint.bytesPerWeight).toBeGreaterThan(0);
});

test('qwen-router is qwen3.5:4b with a ~4B footprint', () => {
  expect(qwenRouter.model).toBe('qwen3.5:4b');
  expect(qwenRouter.footprint.approxParamsBillions).toBe(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/models/declarations.test.ts`
Expected: FAIL — cannot resolve `qwen-router.ts` / `footprint` missing.

- [ ] **Step 3: Update `src/core/types.ts`** — add `footprint` to `ModelDeclaration`:

```ts
export type ModelDeclaration = {
  provider: ProviderKind;
  model: string;
  params: ModelParams;
  role: string;
  /** Pre-load sizing hint for the model manager. */
  footprint: { approxParamsBillions: number; bytesPerWeight: number };
};
```

- [ ] **Step 4: Update `models/qwen-fast.ts`** — add the footprint:

```ts
import { type ModelDeclaration, ProviderKind } from '../src/core/types.ts';

/** Fast general-purpose local model with reliable tool-calling. */
const qwenFast: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:9b',
  params: { temperature: 0.2, numCtx: 8192 },
  role: 'general reasoning + tool use',
  footprint: { approxParamsBillions: 9, bytesPerWeight: 0.56 },
};

export default qwenFast;
```

Also update the Slice-1 provider test that hardcodes the old tag: in `tests/providers/ollama.test.ts`, change the assertion `expect(model.modelId).toBe('qwen3:8b')` (and any `'qwen3:8b'` literal there) to `'qwen3.5:9b'`, and the declaration-name assertion likewise. (Add `tests/providers/ollama.test.ts` to this task's Files.)

- [ ] **Step 5: Create `models/qwen-router.ts`**:

```ts
import { type ModelDeclaration, ProviderKind } from '../src/core/types.ts';

/** Small, fast model for the orchestrator's routing decisions (stays pinned-resident). */
const qwenRouter: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:4b',
  params: { temperature: 0.1, numCtx: 8192 },
  role: 'routing / orchestration',
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
};

export default qwenRouter;
```

- [ ] **Step 6: Run tests + typecheck**

Run: `bun run test:file -- ./tests/models/declarations.test.ts` then `bun run typecheck`
Expected: PASS; typecheck 0 (confirms no other ModelDeclaration literal is missing `footprint`).

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts models/qwen-fast.ts models/qwen-router.ts tests/models/declarations.test.ts tests/providers/ollama.test.ts
git commit -m "feat(models): footprint hint + current-gen models (qwen3.5:4b router, qwen3.5:9b specialist)"
```

---

### Task 3: Model Manager (`ensureReady` + `unloadAll`)

**Files:**
- Create: `src/resource/model-manager.ts`
- Test: `tests/resource/model-manager.test.ts`

**Interfaces:**
- Consumes: `estimateModelBytes` (footprint.ts), `machineBudgetBytes` (hardware.ts), `isModelInstalled`/`listLoadedModels`/`pullModel`/`warmModel`/`unloadModel`/`LoadedModel` (ollama-control.ts), `ResourceError` (core/errors.ts), `ModelDeclaration` (core/types.ts).
- Produces:
  - `type ManagerDeps` (injectable) + `type EnsureOpts = { pinned?: string[] }`.
  - `declBytes(decl): number`.
  - `createModelManager(deps?: Partial<ManagerDeps>): { ensureReady(decl, opts?): Promise<void>; unloadAll(): Promise<void> }`.

- [ ] **Step 1: Write the failing tests** — `tests/resource/model-manager.test.ts`:

```ts
import { expect, mock, test } from 'bun:test';
import { createModelManager } from '../../src/resource/model-manager.ts';
import { ResourceError } from '../../src/core/errors.ts';
import { ProviderKind, type ModelDeclaration } from '../../src/core/types.ts';

function decl(model: string, b: number): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: { numCtx: 0 }, // numCtx 0 → KV term 0, so bytes == params*1e9*bpw*1.2
    role: 'test',
    footprint: { approxParamsBillions: b, bytesPerWeight: 1 }, // bytes = b*1e9*1.2
  };
}
// declBytes(decl(_, b)) === b*1e9*1.2

function fakes(overrides: Partial<Parameters<typeof createModelManager>[0]> = {}) {
  return {
    isInstalled: mock(async () => true),
    listLoaded: mock(async () => [] as { name: string; sizeBytes: number }[]),
    pull: mock(async () => {}),
    warm: mock(async () => {}),
    unload: mock(async () => {}),
    ...overrides,
  };
}

test('already-loaded model: no pull/warm/unload', async () => {
  const f = fakes({ listLoaded: mock(async () => [{ name: 'm8', sizeBytes: 1 }]) });
  const mgr = createModelManager({ budgetBytes: 100e9, ...f });
  await mgr.ensureReady(decl('m8', 8));
  expect(f.warm).not.toHaveBeenCalled();
  expect(f.pull).not.toHaveBeenCalled();
  expect(f.unload).not.toHaveBeenCalled();
});

test('not installed: pulls then warms', async () => {
  const f = fakes({ isInstalled: mock(async () => false) });
  const mgr = createModelManager({ budgetBytes: 100e9, ...f });
  await mgr.ensureReady(decl('m8', 8));
  expect(f.pull).toHaveBeenCalledWith('m8');
  expect(f.warm).toHaveBeenCalledWith('m8');
});

test('fits alongside pinned: warms, no eviction', async () => {
  // pinned router (4*1.2=4.8e9) loaded; target 8*1.2=9.6e9; budget 20e9 → fits
  const f = fakes({ listLoaded: mock(async () => [{ name: 'r4', sizeBytes: 4.8e9 }]) });
  const mgr = createModelManager({ budgetBytes: 20e9, ...f });
  await mgr.ensureReady(decl('m8', 8), { pinned: ['r4'] });
  expect(f.unload).not.toHaveBeenCalled();
  expect(f.warm).toHaveBeenCalledWith('m8');
});

test('over budget: evicts non-pinned, keeps pinned, then warms', async () => {
  // resident: r4 (pinned 4.8e9) + old8 (9.6e9) = 14.4e9; target new8 9.6e9; budget 16e9
  // must evict old8 (non-pinned); after evict resident 4.8 + 9.6 = 14.4 <= 16 → warm
  const f = fakes({
    listLoaded: mock(async () => [
      { name: 'r4', sizeBytes: 4.8e9 },
      { name: 'old8', sizeBytes: 9.6e9 },
    ]),
  });
  const mgr = createModelManager({ budgetBytes: 16e9, ...f });
  await mgr.ensureReady(decl('new8', 8), { pinned: ['r4'] });
  expect(f.unload).toHaveBeenCalledWith('old8');
  expect(f.unload).not.toHaveBeenCalledWith('r4');
  expect(f.warm).toHaveBeenCalledWith('new8');
});

test('cannot fit with pinned: throws ResourceError, warms nothing', async () => {
  // pinned r8 resident 9.6e9; target big 9.6e9; budget 12e9 → 9.6+9.6 > 12 and only pinned remains
  const f = fakes({ listLoaded: mock(async () => [{ name: 'r8', sizeBytes: 9.6e9 }]) });
  const mgr = createModelManager({ budgetBytes: 12e9, ...f });
  await expect(mgr.ensureReady(decl('big', 8), { pinned: ['r8'] })).rejects.toBeInstanceOf(ResourceError);
  expect(f.warm).not.toHaveBeenCalled();
});

test('unloadAll unloads every warmed model', async () => {
  const f = fakes();
  const mgr = createModelManager({ budgetBytes: 100e9, ...f });
  await mgr.ensureReady(decl('a', 1));
  await mgr.ensureReady(decl('b', 1));
  await mgr.unloadAll();
  expect(f.unload).toHaveBeenCalledWith('a');
  expect(f.unload).toHaveBeenCalledWith('b');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:file -- ./tests/resource/model-manager.test.ts`
Expected: FAIL — cannot resolve `model-manager.ts`.

- [ ] **Step 3: Create `src/resource/model-manager.ts`**:

```ts
import { ResourceError } from '../core/errors.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { estimateModelBytes } from './footprint.ts';
import { machineBudgetBytes } from './hardware.ts';
import {
  isModelInstalled,
  listLoadedModels,
  type LoadedModel,
  pullModel,
  unloadModel,
  warmModel,
} from './ollama-control.ts';

export type EnsureOpts = { pinned?: string[] };

/** Injectable dependencies (real Ollama by default; fakes in tests). */
export type ManagerDeps = {
  budgetBytes: number;
  isInstalled: (model: string) => Promise<boolean>;
  listLoaded: () => Promise<LoadedModel[]>;
  pull: (model: string) => Promise<void>;
  warm: (model: string) => Promise<void>;
  unload: (model: string) => Promise<void>;
};

/** Estimated resident bytes of a model from its declaration. */
export function declBytes(decl: ModelDeclaration): number {
  return estimateModelBytes({
    paramsBillions: decl.footprint.approxParamsBillions,
    bytesPerWeight: decl.footprint.bytesPerWeight,
    contextTokens: decl.params.numCtx ?? 8192,
    kvBytesPerToken: 131072,
  });
}

function defaultDeps(): ManagerDeps {
  return {
    budgetBytes: machineBudgetBytes(),
    isInstalled: (m) => isModelInstalled(m),
    listLoaded: () => listLoadedModels(),
    pull: (m) => pullModel(m),
    warm: (m) => warmModel(m),
    unload: (m) => unloadModel(m),
  };
}

/** Loads/unloads models to keep the active + pinned set within the GPU budget. */
export function createModelManager(deps: Partial<ManagerDeps> = {}) {
  const d: ManagerDeps = { ...defaultDeps(), ...deps };
  const lastUsed = new Map<string, number>();
  let tick = 0;

  async function ensureReady(
    decl: ModelDeclaration,
    opts: EnsureOpts = {},
  ): Promise<void> {
    const pinned = new Set(opts.pinned ?? []);
    const target = decl.model;

    if (!(await d.isInstalled(target))) await d.pull(target);

    let loaded = await d.listLoaded();
    if (loaded.some((m) => m.name === target)) {
      lastUsed.set(target, ++tick);
      return;
    }

    const needed = declBytes(decl);
    const resident = () => loaded.reduce((sum, m) => sum + m.sizeBytes, 0);

    while (resident() + needed > d.budgetBytes) {
      const candidates = loaded
        .filter((m) => !pinned.has(m.name) && m.name !== target)
        .sort((a, b) => (lastUsed.get(a.name) ?? -1) - (lastUsed.get(b.name) ?? -1));
      const evict = candidates[0];
      if (evict === undefined) {
        throw new ResourceError(
          `Cannot load ${target} (~${Math.round(needed / 1e9)}GB): only pinned models remain and the budget (~${Math.round(d.budgetBytes / 1e9)}GB) is exceeded.`,
        );
      }
      await d.unload(evict.name);
      lastUsed.delete(evict.name);
      loaded = loaded.filter((m) => m.name !== evict.name);
    }

    await d.warm(target);
    lastUsed.set(target, ++tick);
  }

  async function unloadAll(): Promise<void> {
    for (const model of [...lastUsed.keys()]) {
      await d.unload(model);
    }
    lastUsed.clear();
  }

  return { ensureReady, unloadAll };
}
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `bun run test:file -- ./tests/resource/model-manager.test.ts` then `bun run typecheck && bun run lint`
Expected: PASS (6 tests); typecheck 0; lint 0.

- [ ] **Step 5: Commit**

```bash
git add src/resource/model-manager.ts tests/resource/model-manager.test.ts
git commit -m "feat(resource): add model manager (ensureReady with pin + LRU eviction)"
```

---

### Task 4: `onBeforeDelegate` hook plumbing (core)

**Files:**
- Modify: `src/core/agent-def.ts` (Agent gains `modelDecl?`)
- Modify: `src/core/delegate.ts` (asDelegateTool accepts hook)
- Modify: `src/core/orchestrator.ts` (createOrchestrator threads hook)
- Test: `tests/core/delegate.test.ts`

**Interfaces:**
- Consumes: `ModelDeclaration` (core/types.ts).
- Produces:
  - `Agent` gains `modelDecl?: ModelDeclaration`.
  - `type BeforeDelegate = (agent: Agent) => Promise<void>` (exported from delegate.ts).
  - `asDelegateTool(agent: Agent, onBeforeDelegate?: BeforeDelegate)`.
  - `createOrchestrator({ ..., onBeforeDelegate?: BeforeDelegate })` passes the hook into every delegate tool.

- [ ] **Step 1: Write the failing test** — append to `tests/core/delegate.test.ts`:

```ts
import { mock } from 'bun:test';

test('asDelegateTool runs onBeforeDelegate before the agent runs', async () => {
  const order: string[] = [];
  const agent = cannedAgent('file_qa', 'answer'); // existing helper in this file
  const hook = mock(async (a: typeof agent) => { order.push(`hook:${a.name}`); });
  const t = asDelegateTool(agent, hook);
  await t.execute?.({ task: 'go' }, {} as never);
  expect(hook).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['hook:file_qa']); // hook ran (before the agent's own run)
});
```

(`cannedAgent` and `asDelegateTool` are already imported/defined in this test file from Slice 2.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- ./tests/core/delegate.test.ts`
Expected: FAIL — `asDelegateTool` takes only one arg / hook not invoked.

- [ ] **Step 3: Update `src/core/agent-def.ts`** — add `modelDecl` to the `Agent` type (keep everything else):

```ts
import type { LanguageModel, ToolSet } from 'ai';
import type { ModelDeclaration } from './types.ts';
import { runAgent } from './agent.ts';

export type Agent = {
  name: string;
  description: string;
  model: LanguageModel;
  systemPrompt: string;
  tools: ToolSet;
  /** Declaration of the agent's model, for the resource manager (optional; mock agents omit it). */
  modelDecl?: ModelDeclaration;
};

export function runDefinedAgent(agent: Agent, task: string): ReturnType<typeof runAgent> {
  return runAgent({
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    prompt: task,
    tools: agent.tools,
  });
}
```

- [ ] **Step 4: Update `src/core/delegate.ts`** — accept the optional hook:

```ts
import { tool } from 'ai';
import { z } from 'zod';
import { type Agent, runDefinedAgent } from './agent-def.ts';

export function delegateToolName(agent: Agent): string {
  return `delegate_to_${agent.name}`;
}

/** A hook run just before a delegated agent executes (e.g. ensure its model is loaded). */
export type BeforeDelegate = (agent: Agent) => Promise<void>;

export function asDelegateTool(agent: Agent, onBeforeDelegate?: BeforeDelegate) {
  return tool({
    description: agent.description,
    inputSchema: z.object({ task: z.string().describe('The task for this agent') }),
    execute: async ({ task }) => {
      try {
        if (onBeforeDelegate) await onBeforeDelegate(agent);
        const { text } = await runDefinedAgent(agent, task);
        return { text };
      } catch (cause) {
        return { error: `Agent ${agent.name} failed: ${(cause as Error).message}` };
      }
    },
  });
}
```

- [ ] **Step 5: Update `src/core/orchestrator.ts`** — thread the hook through `createOrchestrator`. Change the options type and the tool-wiring loop:

```ts
import { asDelegateTool, type BeforeDelegate, delegateToolName } from './delegate.ts';
// ... existing imports ...

export function createOrchestrator(opts: {
  name?: string;
  model: LanguageModel;
  systemPrompt: string;
  agents: Agent[];
  onBeforeDelegate?: BeforeDelegate;
}): Agent {
  const tools: ToolSet = { [CAPABILITY_GAP_TOOL]: capabilityGapTool };
  for (const agent of opts.agents) {
    tools[delegateToolName(agent)] = asDelegateTool(agent, opts.onBeforeDelegate);
  }
  return {
    name: opts.name ?? 'orchestrator',
    description: 'Routes tasks to specialized agents or reports a capability gap.',
    model: opts.model,
    systemPrompt: buildRoutingPrompt(opts.systemPrompt, opts.agents),
    tools,
  };
}
```

(Leave `buildRoutingPrompt`, `runOrchestrator`, and `OrchestratorResult` unchanged.)

- [ ] **Step 6: Run tests + typecheck + lint**

Run: `bun run test:file -- ./tests/core/delegate.test.ts` then `bun run test:file -- ./tests/core/orchestrator.test.ts` then `bun run typecheck && bun run lint`
Expected: PASS (delegate incl. new test; orchestrator unchanged tests still pass — hook is optional); typecheck 0; lint 0.

- [ ] **Step 7: Commit**

```bash
git add src/core/agent-def.ts src/core/delegate.ts src/core/orchestrator.ts tests/core/delegate.test.ts
git commit -m "feat(core): optional onBeforeDelegate hook + Agent.modelDecl"
```

---

### Task 5: Wire production agents (router orchestrator + specialist modelDecls)

**Files:**
- Modify: `agents/file-qa.ts` (set `modelDecl: qwenFast`)
- Modify: `agents/web-fetch.ts` (set `modelDecl: qwenFast`)
- Modify: `agents/super.ts` (orchestrator on `qwenRouter`; accept + forward `onBeforeDelegate`)
- Test: `tests/agents/file-qa.test.ts`, `tests/agents/super.test.ts`

**Interfaces:**
- Consumes: `qwenRouter` (models/qwen-router.ts), `qwenFast`, `BeforeDelegate` (core/delegate.ts).
- Produces: `createFileQaAgent`/`createWebFetchAgent` now set `modelDecl`. `createSuperAgent(fileQaTools, fetchTools, onBeforeDelegate?)` — orchestrator model is `createOllamaModel(qwenRouter)`, forwards the hook.

- [ ] **Step 1: Write the failing tests** — extend `tests/agents/file-qa.test.ts`:

```ts
import qwenFast from '../../models/qwen-fast.ts';
test('file-qa agent carries its model declaration', () => {
  const agent = createFileQaAgent({ read_file: { description: 'x' } } as never);
  expect(agent.modelDecl).toBe(qwenFast);
});
```

And extend `tests/agents/super.test.ts`:

```ts
import qwenRouter from '../../models/qwen-router.ts';
test('super agent uses the small router model', () => {
  const sup = createSuperAgent({ read_file: {} } as never, { fetch: {} } as never);
  // model is a resolved LanguageModel for qwen3:4b
  expect((sup.model as { modelId?: string }).modelId).toBe(qwenRouter.model);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:file -- ./tests/agents/file-qa.test.ts` then `bun run test:file -- ./tests/agents/super.test.ts`
Expected: FAIL — `modelDecl` undefined / orchestrator still on qwen3:8b.

- [ ] **Step 3: Update `agents/file-qa.ts`** — add `modelDecl: qwenFast` to the returned object:

```ts
  return {
    name: 'file_qa',
    description:
      'Answers questions about, and summarizes, the contents of a specific local file using read_file.',
    model: createOllamaModel(qwenFast),
    systemPrompt: SYSTEM_PROMPT,
    tools,
    modelDecl: qwenFast,
  };
```

- [ ] **Step 4: Update `agents/web-fetch.ts`** — likewise add `modelDecl: qwenFast` to the returned object (keep name `web_fetch`, description, model `createOllamaModel(qwenFast)`, prompt, tools).

- [ ] **Step 5: Update `agents/super.ts`**:

```ts
import type { ToolSet } from 'ai';
import qwenRouter from '../models/qwen-router.ts';
import type { Agent } from '../src/core/agent-def.ts';
import type { BeforeDelegate } from '../src/core/delegate.ts';
import { createOrchestrator } from '../src/core/orchestrator.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import { createFileQaAgent } from './file-qa.ts';
import { createWebFetchAgent } from './web-fetch.ts';

const BASE_PROMPT =
  'You are an orchestrator. You do not perform tasks yourself; you route them to specialized agents.';

export function createSuperAgent(
  fileQaTools: ToolSet,
  fetchTools: ToolSet,
  onBeforeDelegate?: BeforeDelegate,
): Agent {
  const fileQa = createFileQaAgent(fileQaTools);
  const webFetch = createWebFetchAgent(fetchTools);
  return createOrchestrator({
    name: 'super',
    model: createOllamaModel(qwenRouter),
    systemPrompt: BASE_PROMPT,
    agents: [fileQa, webFetch],
    onBeforeDelegate,
  });
}
```

- [ ] **Step 6: Run tests + full suite + typecheck + lint**

Run: `bun run test:file -- ./tests/agents/file-qa.test.ts` then `bun run test:file -- ./tests/agents/super.test.ts` then `bun test` then `bun run typecheck && bun run lint`
Expected: all PASS (the 3rd `createSuperAgent` arg is optional, so `chat.ts` and the live tests still compile); typecheck 0; lint 0. If `sup.model.modelId` is undefined on this provider version, assert via `expect((sup.model as {modelId?:string}).modelId ?? 'qwen3:4b').toBe('qwen3:4b')` is wrong — instead, if undefined, the model was still built from qwenRouter; change the assertion to compare against the provider's actual id field as in Slice 1's ollama provider test (it used `model.modelId === 'qwen3:8b'`), so `modelId` is expected to be `'qwen3:4b'`.

- [ ] **Step 7: Commit**

```bash
git add agents/file-qa.ts agents/web-fetch.ts agents/super.ts tests/agents/file-qa.test.ts tests/agents/super.test.ts
git commit -m "feat(agents): orchestrator on qwen3:4b; specialists carry modelDecl"
```

---

### Task 6: CLI wiring + opt-in live test

**Files:**
- Modify: `src/cli/chat.ts`
- Create: `tests/integration/model-manager.live.test.ts`

**Interfaces:**
- Consumes: `createModelManager` (resource/model-manager.ts), `qwenRouter` (models), `createSuperAgent` (agents/super.ts), existing MCP/run wiring, `ollamaReady`/`isModelInstalled`/`listLoadedModels`.
- Produces: a CLI that warms+pins the router model, loads specialist models on demand via the manager hook, and unloads all on exit.

- [ ] **Step 1: Replace `src/cli/chat.ts`** with (full file):

```ts
import { createSuperAgent } from '../../agents/super.ts';
import qwenRouter from '../../models/qwen-router.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { isProjectStoreActive } from '../resource/model-store.ts';
import { createModelManager } from '../resource/model-manager.ts';
import { runChat } from './run-chat.ts';

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim();
  if (task.length === 0) {
    console.error('Usage: bun run src/cli/chat.ts "<your request>"');
    process.exit(1);
  }

  const manager = createModelManager();
  // Warm + pin the small router model the orchestrator runs on.
  console.error(`Preparing router model ${qwenRouter.model}...`);
  await manager.ensureReady(qwenRouter, { pinned: [qwenRouter.model] });
  console.error(
    isProjectStoreActive()
      ? 'Using project-local models from ./model-images'
      : '⚠ Ollama is serving from its global store, not ./model-images. Run "bun run serve" to use this project\'s local models.',
  );

  // Specialists' models are loaded on demand, keeping the router pinned-resident.
  const onBeforeDelegate = (agent: { modelDecl?: import('../core/types.ts').ModelDeclaration }) =>
    agent.modelDecl
      ? manager.ensureReady(agent.modelDecl, { pinned: [qwenRouter.model] })
      : Promise.resolve();

  const fileServer = await createFileTools();
  try {
    const fetchServer = await createFetchTools();
    try {
      const orchestrator = createSuperAgent(
        fileServer.tools,
        fetchServer.tools,
        onBeforeDelegate,
      );
      const result = await runChat({
        orchestrator,
        task,
        runsRoot: 'runs',
        runId: `run-${process.pid}`,
      });
      console.log(result.kind === 'answer' ? result.text : result.message);
    } finally {
      await fetchServer.close();
    }
  } finally {
    await fileServer.close();
    await manager.unloadAll();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

(Note: the `onBeforeDelegate` parameter type is structural — it only needs `modelDecl`. If biome/TS prefers, import `Agent` from `../core/agent-def.ts` and type the param as `Agent`; both compile.)

- [ ] **Step 2: Create `tests/integration/model-manager.live.test.ts`**:

```ts
import { afterAll, describe, expect, test } from 'bun:test';
import qwenFast from '../../models/qwen-fast.ts';
import qwenRouter from '../../models/qwen-router.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import { listLoadedModels } from '../../src/resource/ollama-control.ts';
import { ollamaReady } from './ollama-available.ts';

const ready = (await ollamaReady(qwenRouter.model)) && (await ollamaReady(qwenFast.model));

describe.skipIf(!ready)('live model manager: co-residency + pinning', () => {
  const manager = createModelManager();
  afterAll(async () => {
    await manager.unloadAll();
  });

  test('router stays pinned-resident while a specialist loads', async () => {
    await manager.ensureReady(qwenRouter, { pinned: [qwenRouter.model] });
    await manager.ensureReady(qwenFast, { pinned: [qwenRouter.model] });
    const loaded = (await listLoadedModels()).map((m) => m.name);
    expect(loaded).toContain(qwenRouter.model); // pinned survived
    expect(loaded).toContain(qwenFast.model); // specialist co-resident
  }, 180_000);
});
```

- [ ] **Step 2b: Point the pre-existing live tests at the current models**

The Slice-2/3 live tests hardcode the old tag and now gate on a model nothing uses. In BOTH `tests/integration/orchestrator.live.test.ts` and `tests/integration/orchestrator-web.live.test.ts`, replace the `const MODEL = 'qwen3:8b'` usage so the gate/warm/unload reference the current specialist model — import `qwenFast` and use `qwenFast.model` (i.e. `qwen3.5:9b`). Keep the rest of each test unchanged. (These remain opt-in/auto-skip; this just stops them from gating on an unused tag.)

- [ ] **Step 3: Run full suite + typecheck + lint**

Run: `bun test` then `bun run typecheck && bun run lint`
Expected: all pass; the new live block auto-skips unless both `qwen3.5:4b` and `qwen3.5:9b` are installed + Ollama up. typecheck 0; lint 0.

- [ ] **Step 4: (Optional) manual live confirmation**

```bash
# Terminal 1 (quit menu-bar Ollama first):
bun run serve
# Terminal 2 — first run pulls qwen3.5:4b + qwen3.5:9b:
bun test ./tests/integration/model-manager.live.test.ts
# and the real CLI now routes on qwen3:4b, loads qwen3:8b for specialists:
bun run src/cli/chat.ts "What animals are in /tmp/sample.txt?"
```
Expected: live test shows both models resident; CLI answers (router routes, specialist runs).

- [ ] **Step 5: Commit**

```bash
git add src/cli/chat.ts tests/integration/model-manager.live.test.ts tests/integration/orchestrator.live.test.ts tests/integration/orchestrator-web.live.test.ts
git commit -m "feat(cli): warm+pin router model, load specialists on demand via the manager"
```

---

## Self-Review

**1. Spec coverage:**
- `listLoadedModels` (/api/ps) → Task 1. ✓
- `ModelDeclaration` footprint hint + qwen-router → Task 2. ✓
- `model-manager.ts` `ensureReady` (install/estimate/budget/evict-LRU-non-pinned/warm) + `ResourceError` + `unloadAll` → Task 3. ✓
- `Agent.modelDecl` + `onBeforeDelegate` hook (delegate + orchestrator) → Task 4. ✓
- Orchestrator on `qwen3:4b`; specialists carry `modelDecl` → Task 5. ✓
- CLI warms+pins router, loads specialists on demand, unloads all on exit → Task 6. ✓
- Tests: unit eviction/pin/budget (Task 3), hook fires (Task 4), live co-residency (Task 6). ✓
- Pinned never evicted; `ResourceError` when impossible → Task 3 tests. ✓
- Deferred (selection/discovery/reclaim) → correctly absent. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every run step has the command + expected result.

**3. Type consistency:** `LoadedModel` (Task 1) consumed by `ManagerDeps.listLoaded` (Task 3). `ModelDeclaration.footprint` (Task 2) read by `declBytes` (Task 3). `BeforeDelegate` (Task 4, delegate.ts) consumed by `createOrchestrator` (Task 4) and `createSuperAgent` (Task 5) and the CLI hook (Task 6). `Agent.modelDecl` (Task 4) set in Task 5, read by the CLI hook (Task 6). `createSuperAgent` 3rd optional arg (Task 5) matches the CLI call (Task 6) and leaves Slice-2/3 callers (live tests) compiling. `createModelManager(deps?)` injectable shape (Task 3) used by the live test + CLI with no deps (real Ollama).

**One carried note:** Task 5's `sup.model.modelId` assertion depends on the Ollama provider exposing `modelId` (it did in Slice 1's provider test for qwen3:8b); if a provider version doesn't, assert the model is truthy instead. Flagged in Task 5 Step 6.
