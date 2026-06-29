# Slice 5 — Dynamic Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent declare a capability *requirement* instead of a hardcoded model; a registry + selector picks the best model that fits the **live** memory budget per delegation, the manager loads it, and a genuine no-fit surfaces honestly instead of being swallowed.

**Architecture:** A pure `selectCandidates` (capability hard-filter + largest-that-fits rank + warm-aware tie-break) feeds a live `resolveModel` fallback loop that walks candidates best-first against the Model Manager (the single fit-authority). The chosen model is **lazily bound** at delegation time via `onBeforeDelegate`. A capture-and-check seam turns a real `ResourceError` into a distinct `{kind:'resource'}` orchestrator result.

**Tech Stack:** TypeScript + Bun + Vercel AI SDK 6 (`ai`, `ollama-ai-provider-v2`), Ollama HTTP control API, `bun:test` + `MockLanguageModelV3` from `ai/test`, Biome lint.

## Global Constraints

- Use **`bun`**, never `npm`. Tests: `bun test`. Typecheck: `bun run typecheck`. Lint: `bun run lint:file -- "<files>"`.
- TypeScript style: prefer `type` over `interface`; **string `enum`** over string-literal unions for finite named sets (`enum Foo { A = 'A' }`); discriminated unions stay `type`.
- Early returns over nested conditionals; small focused files; descriptive names; plain self-explanatory code.
- All intra-repo imports use the **`.ts`** extension (e.g. `'./types.ts'`).
- Model **declarations live at repo-root `models/`** (e.g. `models/qwen-fast.ts`); core code under `src/`.
- Notices/diagnostics go to **`console.error`**; only the final user answer goes to `console.log`. No leftover `console.log` debugging.
- Conventional commits: subject `type(scope): summary`. Commit after each task's tests pass.
- Verified dependency pins (do not bump): `ai@^6`, `ollama-ai-provider-v2@^3`, `@ai-sdk/mcp@^1`, `zod@^4`.
- Provider/model facts: `tool({inputSchema})`; Ollama provider baseURL has `/api` suffix; manager `ensureReady(decl, {pinned})` returns the chosen `numCtx`; `ResourceError` constructor is `(message, options?: { cause })`.

**Design note (refinement vs spec):** `ModelRequirement` carries only `{ role, requires, prefer }` — **no** `numCtx`. The chosen `ModelDeclaration` already carries `params.numCtx` (router 8192, specialist 16384), and `ensureReady` reads it; adding `numCtx` to the requirement would create two sources of truth. `ModelDeclaration.capabilities` is **optional** (`capabilities?: Capability[]`) so existing declarations and test helpers that omit it still typecheck; the selector treats a missing value as `[]`.

---

### Task 1: Selection types, capabilities, and the registry

**Files:**
- Modify: `src/core/types.ts`
- Modify: `models/qwen-fast.ts`
- Modify: `models/qwen-router.ts`
- Create: `models/registry.ts`
- Test: `tests/models/registry.test.ts`

**Interfaces:**
- Produces: `enum Capability { Tools = 'tools' }`; `enum PreferPolicy { LargestThatFits = 'largest-that-fits' }`; `type ModelRequirement = { role: string; requires: Capability[]; prefer: PreferPolicy }`; `ModelDeclaration.capabilities?: Capability[]`; `REGISTRY: ModelDeclaration[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/models/registry.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { REGISTRY } from '../../models/registry.ts';
import { Capability } from '../../src/core/types.ts';

test('registry contains the two verified rungs, both tool-capable', () => {
  const names = REGISTRY.map((d) => d.model).sort();
  expect(names).toEqual(['qwen3.5:4b', 'qwen3.5:9b']);
  for (const d of REGISTRY) {
    expect(d.capabilities ?? []).toContain(Capability.Tools);
  }
});

test('registry has a real capability ladder (distinct sizes)', () => {
  const sizes = REGISTRY.map((d) => d.footprint.approxParamsBillions);
  expect(new Set(sizes).size).toBe(REGISTRY.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/models/registry.test.ts`
Expected: FAIL — cannot resolve `../../models/registry.ts` / `Capability` not exported.

- [ ] **Step 3: Add the types**

In `src/core/types.ts`, after the `ProviderKind` enum, add:

```ts
/** A capability a model advertises and an agent can require. String enum (extensible). */
export enum Capability {
  Tools = 'tools',
  // future: Vision = 'vision', LongContext = 'long-context', Coding = 'coding'
}

/** How the selector ranks the candidates that survive the hard filter. */
export enum PreferPolicy {
  LargestThatFits = 'largest-that-fits',
  // future: SmallestThatFits, QualityRanked, GlobalSchedule
}

/** What a requirement-driven agent declares instead of a concrete model name. */
export type ModelRequirement = {
  /** Human description of the role. */
  role: string;
  /** HARD filter — every listed capability must be present on the model. */
  requires: Capability[];
  /** SOFT rank over the survivors. */
  prefer: PreferPolicy;
};
```

In the `ModelDeclaration` type, add the optional field (after `role`):

```ts
  /** Capabilities this model provides; selector hard-filters on these. Missing = none. */
  capabilities?: Capability[];
```

- [ ] **Step 4: Tag the two declarations**

In `models/qwen-fast.ts`, change the import and add `capabilities`:

```ts
import {
  Capability,
  type ModelDeclaration,
  ProviderKind,
} from '../src/core/types.ts';

/** Fast general-purpose local model with reliable tool-calling. */
const qwenFast: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:9b',
  params: { temperature: 0.2, numCtx: 16384 },
  role: 'general reasoning + tool use',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 9, bytesPerWeight: 0.56 },
};

export default qwenFast;
```

In `models/qwen-router.ts`, the same treatment:

```ts
import {
  Capability,
  type ModelDeclaration,
  ProviderKind,
} from '../src/core/types.ts';

/** Small, fast model for the orchestrator's routing decisions (stays pinned-resident). */
const qwenRouter: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:4b',
  params: { temperature: 0.1, numCtx: 8192 },
  role: 'routing / orchestration',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
};

export default qwenRouter;
```

- [ ] **Step 5: Create the registry**

Create `models/registry.ts`:

```ts
import type { ModelDeclaration } from '../src/core/types.ts';
import qwenFast from './qwen-fast.ts';
import qwenRouter from './qwen-router.ts';

/**
 * Bootstrap content of a machine-adaptive capability LADDER. The selector is
 * N-rung capable; the live-budget fits-filter makes any rung inert where it does
 * not fit. Only rungs verified on this hardware ship here; Slice 6 discovery will
 * replace this static array with a per-machine runtime fetch.
 */
export const REGISTRY: ModelDeclaration[] = [qwenRouter, qwenFast];
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/models/registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts models/qwen-fast.ts models/qwen-router.ts models/registry.ts tests/models/registry.test.ts
git commit -m "feat(models): capability tags + model requirement types + registry"
```

---

### Task 2: `selectCandidates` — pure capability filter + rank

**Files:**
- Create: `src/resource/selector.ts`
- Test: `tests/resource/selector.test.ts`

**Interfaces:**
- Consumes: `Capability`, `PreferPolicy`, `ModelRequirement`, `ModelDeclaration` (Task 1); `weightsBytes` from `./footprint.ts`.
- Produces: `selectCandidates(req: ModelRequirement, registry: ModelDeclaration[], loaded?: ReadonlySet<string>): ModelDeclaration[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/resource/selector.test.ts`:

```ts
import { expect, test } from 'bun:test';
import {
  Capability,
  type ModelDeclaration,
  PreferPolicy,
  ProviderKind,
} from '../../src/core/types.ts';
import { selectCandidates } from '../../src/resource/selector.ts';

function m(
  model: string,
  b: number,
  caps: Capability[],
  bpw = 0.56,
): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: {},
    role: 'test',
    capabilities: caps,
    footprint: { approxParamsBillions: b, bytesPerWeight: bpw },
  };
}

const tools = { role: 'r', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits };

test('hard-filters out models missing a required capability', () => {
  const reg = [m('big-novtools', 9, []), m('small-tools', 4, [Capability.Tools])];
  const out = selectCandidates(tools, reg);
  expect(out.map((d) => d.model)).toEqual(['small-tools']);
});

test('ranks largest params first', () => {
  const reg = [m('a4', 4, [Capability.Tools]), m('b9', 9, [Capability.Tools])];
  expect(selectCandidates(tools, reg).map((d) => d.model)).toEqual(['b9', 'a4']);
});

test('tie-break: equal params -> smaller footprint first', () => {
  const reg = [m('heavy', 9, [Capability.Tools], 0.9), m('light', 9, [Capability.Tools], 0.5)];
  expect(selectCandidates(tools, reg).map((d) => d.model)).toEqual(['light', 'heavy']);
});

test('warm-aware bias: among identical candidates, resident first', () => {
  const reg = [m('cold', 9, [Capability.Tools]), m('warm', 9, [Capability.Tools])];
  const out = selectCandidates(tools, reg, new Set(['warm']));
  expect(out.map((d) => d.model)).toEqual(['warm', 'cold']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/resource/selector.test.ts`
Expected: FAIL — `selectCandidates` not exported.

- [ ] **Step 3: Implement `selectCandidates`**

Create `src/resource/selector.ts`:

```ts
import {
  type Capability,
  type ModelDeclaration,
  type ModelRequirement,
} from '../core/types.ts';
import { weightsBytes } from './footprint.ts';

function hasAll(decl: ModelDeclaration, requires: Capability[]): boolean {
  const caps = new Set(decl.capabilities ?? []);
  return requires.every((c) => caps.has(c));
}

/**
 * PURE. Hard-filter by `requires`, then rank by `prefer`.
 * LargestThatFits: most params first; tie-break smaller footprint; then a
 * warm-aware bias (resident wins among otherwise-equal candidates) to avoid
 * needless reload churn. The fits check itself is the manager's job, not here.
 */
export function selectCandidates(
  req: ModelRequirement,
  registry: ModelDeclaration[],
  loaded?: ReadonlySet<string>,
): ModelDeclaration[] {
  const capable = registry.filter((d) => hasAll(d, req.requires));
  return [...capable].sort((a, b) => {
    const pa = a.footprint.approxParamsBillions;
    const pb = b.footprint.approxParamsBillions;
    if (pb !== pa) return pb - pa; // largest params first
    const fa = weightsBytes(pa, a.footprint.bytesPerWeight);
    const fb = weightsBytes(pb, b.footprint.bytesPerWeight);
    if (fa !== fb) return fa - fb; // smaller footprint first
    if (loaded) {
      const la = loaded.has(a.model) ? 0 : 1;
      const lb = loaded.has(b.model) ? 0 : 1;
      if (la !== lb) return la - lb; // resident first
    }
    return 0;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/resource/selector.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/resource/selector.ts tests/resource/selector.test.ts
git commit -m "feat(resource): pure selectCandidates (capability filter + largest-that-fits)"
```

---

### Task 3: `resolveModel` — live fallback loop against the manager

**Files:**
- Modify: `src/resource/selector.ts`
- Test: `tests/resource/resolve-model.test.ts`

**Interfaces:**
- Consumes: `selectCandidates` (Task 2); `ResourceError` from `../core/errors.ts`; `EnsureOpts` from `./model-manager.ts`; `LoadedModel` from `./ollama-control.ts`.
- Produces: `type ResolveDeps`; `resolveModel(req, registry, deps: ResolveDeps, opts?: EnsureOpts): Promise<{ decl: ModelDeclaration; numCtx: number }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/resource/resolve-model.test.ts`:

```ts
import { expect, mock, test } from 'bun:test';
import { ResourceError } from '../../src/core/errors.ts';
import {
  Capability,
  type ModelDeclaration,
  PreferPolicy,
  ProviderKind,
} from '../../src/core/types.ts';
import { resolveModel } from '../../src/resource/selector.ts';

function m(model: string, b: number): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: { numCtx: 8192 },
    role: 'test',
    capabilities: [Capability.Tools],
    footprint: { approxParamsBillions: b, bytesPerWeight: 0.56 },
  };
}

const reg = [m('big', 9), m('small', 4)];
const req = { role: 'r', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits };

test('returns the largest model when it fits', async () => {
  const ensureReady = mock(async () => 8192);
  const { decl, numCtx } = await resolveModel(req, reg, { ensureReady });
  expect(decl.model).toBe('big');
  expect(numCtx).toBe(8192);
  expect(ensureReady).toHaveBeenCalledTimes(1);
});

test('falls back to the next candidate when the largest cannot fit', async () => {
  const ensureReady = mock(async (d: ModelDeclaration) => {
    if (d.model === 'big') throw new ResourceError('no fit');
    return 4096;
  });
  const { decl } = await resolveModel(req, reg, { ensureReady });
  expect(decl.model).toBe('small');
  expect(ensureReady).toHaveBeenCalledTimes(2);
});

test('throws ResourceError when nothing fits', async () => {
  const ensureReady = mock(async () => {
    throw new ResourceError('no fit');
  });
  await expect(resolveModel(req, reg, { ensureReady })).rejects.toBeInstanceOf(ResourceError);
});

test('non-resource errors propagate immediately', async () => {
  const ensureReady = mock(async () => {
    throw new TypeError('boom');
  });
  await expect(resolveModel(req, reg, { ensureReady })).rejects.toBeInstanceOf(TypeError);
});

test('passes the resident set to the ranker and calls onAttempt', async () => {
  const ensureReady = mock(async () => 8192);
  const listLoaded = mock(async () => [{ name: 'big', sizeBytes: 1 }]);
  const seen: string[] = [];
  await resolveModel(req, reg, {
    ensureReady,
    listLoaded,
    onAttempt: (d) => {
      seen.push(d.model);
    },
  });
  expect(listLoaded).toHaveBeenCalledTimes(1);
  expect(seen[0]).toBe('big');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/resource/resolve-model.test.ts`
Expected: FAIL — `resolveModel` not exported.

- [ ] **Step 3: Implement `resolveModel`**

Append to `src/resource/selector.ts` (and extend the import at the top):

```ts
import { ResourceError } from '../core/errors.ts';
import type { EnsureOpts } from './model-manager.ts';
import type { LoadedModel } from './ollama-control.ts';
```

```ts
/** Dependencies for the live resolve loop. */
export type ResolveDeps = {
  ensureReady: (d: ModelDeclaration, o?: EnsureOpts) => Promise<number>;
  /** Optional resident-set probe; enables the warm-aware bias. */
  listLoaded?: () => Promise<LoadedModel[]>;
  /** Optional callback fired before each ensureReady attempt (e.g. selection notice). */
  onAttempt?: (decl: ModelDeclaration) => void | Promise<void>;
};

/**
 * LIVE. Walk candidates best-first; the first the manager can ready wins. On a
 * genuine ResourceError, drop to the next candidate; if none fit, rethrow a real
 * ResourceError. The manager remains the single fit-authority (real /api/ps sizes).
 */
export async function resolveModel(
  req: ModelRequirement,
  registry: ModelDeclaration[],
  deps: ResolveDeps,
  opts?: EnsureOpts,
): Promise<{ decl: ModelDeclaration; numCtx: number }> {
  const loaded = deps.listLoaded
    ? new Set((await deps.listLoaded()).map((mm) => mm.name))
    : undefined;
  const candidates = selectCandidates(req, registry, loaded);
  if (candidates.length === 0) {
    throw new ResourceError(
      `No model in the registry satisfies requirements: ${req.requires.join(', ')}.`,
    );
  }
  let lastErr: unknown;
  for (const decl of candidates) {
    await deps.onAttempt?.(decl);
    try {
      const numCtx = await deps.ensureReady(decl, opts);
      return { decl, numCtx };
    } catch (err) {
      if (err instanceof ResourceError) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw new ResourceError(`No candidate model fits the live budget for ${req.role}.`, {
    cause: lastErr,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/resource/resolve-model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/resource/selector.ts tests/resource/resolve-model.test.ts
git commit -m "feat(resource): resolveModel fallback loop with ResourceError propagation"
```

---

### Task 4: Lazy model binding (`BeforeDelegate` model override + abort)

**Files:**
- Modify: `src/core/delegate.ts`
- Modify: `src/core/agent-def.ts:24-37`
- Test: `tests/core/delegate.test.ts`

**Interfaces:**
- Consumes: `runDefinedAgent` (extended here), `Agent`.
- Produces: `BeforeDelegate` return `{ numCtx?: number; model?: LanguageModel; abort?: string } | void`; `runDefinedAgent(agent, task, numCtx?, modelOverride?: LanguageModel)`.

- [ ] **Step 1: Write the failing test**

Create `tests/core/delegate.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { asDelegateTool } from '../../src/core/delegate.ts';

function textModel(label: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: label }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

function agent(): Agent {
  return {
    name: 'spec',
    description: 'a specialist',
    model: textModel('DEFAULT MODEL'),
    systemPrompt: 'sp',
    tools: {},
  };
}

test('uses the model override returned by onBeforeDelegate', async () => {
  const tool = asDelegateTool(agent(), async () => ({ model: textModel('OVERRIDE MODEL') }));
  const out = await tool.execute({ task: 'hi' }, { toolCallId: 't', messages: [] });
  expect(out).toEqual({ text: 'OVERRIDE MODEL' });
});

test('abort short-circuits: agent never runs, returns soft error', async () => {
  let ran = false;
  const a = agent();
  a.model = new MockLanguageModelV3({
    doGenerate: async () => {
      ran = true;
      throw new Error('should not run');
    },
  });
  const tool = asDelegateTool(a, async () => ({ abort: 'no fit' }));
  const out = await tool.execute({ task: 'hi' }, { toolCallId: 't', messages: [] });
  expect(out).toEqual({ error: 'no fit' });
  expect(ran).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/delegate.test.ts`
Expected: FAIL — override ignored (returns 'DEFAULT MODEL'); abort not handled.

- [ ] **Step 3: Extend `runDefinedAgent` with a model override**

In `src/core/agent-def.ts`, replace the `runDefinedAgent` function (lines 24-37):

```ts
/** Run an agent definition against a task, optionally at a chosen context size and model. */
export function runDefinedAgent(
  agent: Agent,
  task: string,
  numCtx?: number,
  modelOverride?: LanguageModel,
): ReturnType<typeof runAgent> {
  return runAgent({
    model: modelOverride ?? agent.model,
    systemPrompt: agent.systemPrompt,
    prompt: task,
    tools: agent.tools,
    providerOptions: ollamaCtxOptions(numCtx),
  });
}
```

(`LanguageModel` is already imported at the top of the file.)

- [ ] **Step 4: Extend `BeforeDelegate` + `asDelegateTool`**

In `src/core/delegate.ts`, add the `LanguageModel` import and replace the `BeforeDelegate` type and the `execute` body:

```ts
import { tool } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { type Agent, runDefinedAgent } from './agent-def.ts';
```

```ts
/**
 * A hook run just before a delegated agent executes. May return a chosen context
 * size, a model to bind for this call, and/or an `abort` message that skips the
 * delegation entirely (returned to the orchestrator as a soft tool error).
 */
export type BeforeDelegate = (
  agent: Agent,
  // biome-ignore lint/suspicious/noConfusingVoidType: void is intentional — hooks may return nothing.
) => Promise<{ numCtx?: number; model?: LanguageModel; abort?: string } | void>;
```

```ts
    execute: async ({ task }) => {
      try {
        const pre = onBeforeDelegate
          ? await onBeforeDelegate(agent)
          : undefined;
        if (pre?.abort) {
          return { error: pre.abort };
        }
        const { text } = await runDefinedAgent(
          agent,
          task,
          pre?.numCtx,
          pre?.model,
        );
        return { text };
      } catch (cause) {
        return {
          error: `Agent ${agent.name} failed: ${(cause as Error).message}`,
        };
      }
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/core/delegate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Regression-check core**

Run: `bun test tests/core`
Expected: PASS (no regressions in existing agent/orchestrator tests).

- [ ] **Step 7: Commit**

```bash
git add src/core/delegate.ts src/core/agent-def.ts tests/core/delegate.test.ts
git commit -m "feat(core): lazy model binding + abort in BeforeDelegate/runDefinedAgent"
```

---

### Task 5: `Agent.modelReq` + requirement-driven specialist factories

**Files:**
- Modify: `src/core/agent-def.ts:6-15`
- Modify: `agents/file-qa.ts`
- Modify: `agents/web-fetch.ts`
- Test: `tests/agents/specialist-req.test.ts`

**Interfaces:**
- Consumes: `ModelRequirement`, `Capability`, `PreferPolicy` (Task 1).
- Produces: `Agent.modelReq?: ModelRequirement`; `createFileQaAgent`/`createWebFetchAgent` set `modelReq` (default `model` stays `qwen3.5:9b`).

- [ ] **Step 1: Write the failing test**

Create `tests/agents/specialist-req.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { createFileQaAgent } from '../../agents/file-qa.ts';
import { createWebFetchAgent } from '../../agents/web-fetch.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';

test('file_qa declares a tool requirement with largest-that-fits', () => {
  const a = createFileQaAgent({});
  expect(a.modelReq?.requires).toContain(Capability.Tools);
  expect(a.modelReq?.prefer).toBe(PreferPolicy.LargestThatFits);
});

test('web_fetch declares a tool requirement with largest-that-fits', () => {
  const a = createWebFetchAgent({});
  expect(a.modelReq?.requires).toContain(Capability.Tools);
  expect(a.modelReq?.prefer).toBe(PreferPolicy.LargestThatFits);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agents/specialist-req.test.ts`
Expected: FAIL — `modelReq` is undefined.

- [ ] **Step 3: Add `modelReq` to the `Agent` type**

In `src/core/agent-def.ts`, update the import and the `Agent` type:

```ts
import type { ModelDeclaration, ModelRequirement } from './types.ts';
```

```ts
/** A reusable agent: its own model + system prompt + tools, plus a routing description. */
export type Agent = {
  name: string; // stable id used in delegate tool names, e.g. 'file_qa'
  description: string; // capability description the orchestrator routes on
  model: LanguageModel;
  systemPrompt: string;
  tools: ToolSet;
  /** Declaration of the agent's model, for the resource manager (optional). */
  modelDecl?: ModelDeclaration;
  /** Capability requirement resolved LIVE by the selector via onBeforeDelegate. */
  modelReq?: ModelRequirement;
};
```

- [ ] **Step 4: Declare `modelReq` on the specialists**

In `agents/file-qa.ts`, update the import and the returned object:

```ts
import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { Capability, PreferPolicy } from '../src/core/types.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
```

```ts
  return {
    name: 'file_qa',
    description:
      'Answers questions about, and summarizes, the contents of a specific local file using read_file.',
    model: createOllamaModel(qwenFast), // default binding; selector may override live
    systemPrompt: SYSTEM_PROMPT,
    tools,
    modelDecl: qwenFast,
    modelReq: {
      role: 'general reasoning + tool use',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  };
```

In `agents/web-fetch.ts`, the same import change and:

```ts
  return {
    name: 'web_fetch',
    description:
      'Fetches a URL and answers questions about or summarizes the content of a web page.',
    model: createOllamaModel(qwenFast), // default binding; selector may override live
    systemPrompt: SYSTEM_PROMPT,
    tools,
    modelDecl: qwenFast,
    modelReq: {
      role: 'general reasoning + tool use',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/agents/specialist-req.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/agent-def.ts agents/file-qa.ts agents/web-fetch.ts tests/agents/specialist-req.test.ts
git commit -m "feat(agents): specialists declare a capability requirement (modelReq)"
```

---

### Task 6: Capture-and-check — `{kind:'resource'}` orchestrator result

**Files:**
- Create: `src/core/resource-capture.ts`
- Modify: `src/core/orchestrator.ts:15-17,64-107`
- Modify: `src/cli/run-chat.ts`
- Test: `tests/core/orchestrator-resource.test.ts`

**Interfaces:**
- Consumes: `ResourceError`, `Agent`, `runDefinedAgent`.
- Produces: `type ResourceCapture = { error?: ResourceError }`; `OrchestratorResult | { kind: 'resource'; message: string }`; `runOrchestrator(orchestrator, task, numCtx?, capture?: ResourceCapture)`; `ChatDeps.capture?`.

- [ ] **Step 1: Write the failing test**

Create `tests/core/orchestrator-resource.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { ResourceError } from '../../src/core/errors.ts';
import { runOrchestrator } from '../../src/core/orchestrator.ts';

function answeringAgent(): Agent {
  return {
    name: 'orch',
    description: 'orchestrator',
    systemPrompt: 'sp',
    tools: {},
    model: new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'a normal answer' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: undefined, reasoning: undefined },
        },
        warnings: [],
      }),
    }),
  };
}

test('captured ResourceError yields kind:resource, overriding the answer', async () => {
  const capture = { error: new ResourceError('no model fits') };
  const result = await runOrchestrator(answeringAgent(), 'do it', undefined, capture);
  expect(result.kind).toBe('resource');
  if (result.kind === 'resource') {
    expect(result.message).toBe('no model fits');
  }
});

test('no capture -> normal answer path unaffected', async () => {
  const result = await runOrchestrator(answeringAgent(), 'do it', undefined, {});
  expect(result.kind).toBe('answer');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestrator-resource.test.ts`
Expected: FAIL — `runOrchestrator` ignores the 4th arg; no `'resource'` kind.

- [ ] **Step 3: Create the capture type**

Create `src/core/resource-capture.ts`:

```ts
import type { ResourceError } from './errors.ts';

/**
 * Shared seam between the delegation hook and the orchestrator. onBeforeDelegate
 * records a genuine resource failure here (the AI SDK would otherwise swallow a
 * thrown ResourceError into a soft tool-result); runOrchestrator reads it and
 * surfaces a hard {kind:'resource'} result instead of a hallucinated answer.
 */
export type ResourceCapture = { error?: ResourceError };
```

- [ ] **Step 4: Wire capture into `runOrchestrator`**

In `src/core/orchestrator.ts`, add the import:

```ts
import type { ResourceCapture } from './resource-capture.ts';
```

Extend `OrchestratorResult`:

```ts
export type OrchestratorResult =
  | { kind: 'answer'; text: string }
  | { kind: 'gap'; missingCapability: string; message: string }
  | { kind: 'resource'; message: string };
```

Replace `runOrchestrator` (lines 64-107) with:

```ts
/** Run the orchestrator; return the answer, a capability gap, or a resource failure. */
export async function runOrchestrator(
  orchestrator: Agent,
  task: string,
  numCtx?: number,
  capture?: ResourceCapture,
): Promise<OrchestratorResult> {
  let text: string;
  let steps: Parameters<typeof findCapabilityGap>[0];

  try {
    const result = await runDefinedAgent(orchestrator, task, numCtx);
    text = result.text;
    steps = result.steps;
  } catch (err) {
    // A genuine resource failure during delegation takes precedence over anything else.
    if (capture?.error) {
      return { kind: 'resource', message: capture.error.message };
    }
    if (err instanceof MaxStepsError) {
      const gap = findCapabilityGap(
        err.steps as Parameters<typeof findCapabilityGap>[0],
      );
      if (gap) {
        return {
          kind: 'gap',
          missingCapability: gap.missingCapability,
          message: `I don't have a capability to handle this yet: ${gap.missingCapability}.`,
        };
      }
    }
    throw err;
  }

  if (capture?.error) {
    return { kind: 'resource', message: capture.error.message };
  }

  const gap = findCapabilityGap(steps);
  if (gap) {
    return {
      kind: 'gap',
      missingCapability: gap.missingCapability,
      message: `I don't have a capability to handle this yet: ${gap.missingCapability}.`,
    };
  }
  return { kind: 'answer', text };
}
```

- [ ] **Step 5: Thread capture through `runChat`**

In `src/cli/run-chat.ts`, add the import, extend `ChatDeps`, pass `capture`, and handle the new kind:

```ts
import type { ResourceCapture } from '../core/resource-capture.ts';
```

```ts
export type ChatDeps = {
  orchestrator: Agent;
  task: string;
  runsRoot: string;
  runId: string;
  routerNumCtx?: number;
  capture?: ResourceCapture;
};
```

Replace the orchestrator call and the result-branch:

```ts
  const result = await runOrchestrator(
    deps.orchestrator,
    deps.task,
    deps.routerNumCtx,
    deps.capture,
  );

  if (result.kind === 'answer') {
    await writeArtifact(run, 'answer.txt', result.text);
    await appendJournal(run.dir, { step: 'answer', data: { text: result.text } });
  } else if (result.kind === 'gap') {
    await writeArtifact(run, 'gap.txt', result.message);
    await appendJournal(run.dir, {
      step: 'gap',
      data: { missingCapability: result.missingCapability },
    });
  } else {
    await writeArtifact(run, 'resource.txt', result.message);
    await appendJournal(run.dir, { step: 'resource', data: { message: result.message } });
  }
  return result;
```

- [ ] **Step 6: Run tests + regression**

Run: `bun test tests/core/orchestrator-resource.test.ts tests/core/orchestrator.test.ts`
Expected: PASS (new + existing orchestrator tests green).

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/core/resource-capture.ts src/core/orchestrator.ts src/cli/run-chat.ts tests/core/orchestrator-resource.test.ts
git commit -m "feat(core): capture-and-check ResourceError -> kind:resource result"
```

---

### Task 7: Selection notice + CLI select-hook wiring

**Files:**
- Create: `src/cli/selection-notice.ts`
- Create: `src/cli/select-hook.ts`
- Modify: `src/cli/chat.ts`
- Test: `tests/cli/selection-notice.test.ts`
- Test: `tests/cli/select-hook.test.ts`

**Interfaces:**
- Consumes: `resolveModel`/`ResolveDeps` (Task 3), `BeforeDelegate`/lazy binding (Task 4), `Agent.modelReq` (Task 5), `ResourceCapture` (Task 6), `REGISTRY` (Task 1), `createOllamaModel`, `weightsBytes`/`kvCacheBytes`, `liveBudgetBytes`, `isModelInstalled`.
- Produces: `formatSelectionNotice(input: NoticeInput): string`; `createSelectHook(deps: SelectHookDeps): BeforeDelegate`.

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/selection-notice.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { Capability, type ModelDeclaration, ProviderKind } from '../../src/core/types.ts';
import { formatSelectionNotice } from '../../src/cli/selection-notice.ts';

const decl: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:9b',
  params: { numCtx: 16384 },
  role: 'general',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 9, bytesPerWeight: 0.56 },
};

test('notice includes model, size, ctx, budget and install state', () => {
  const s = formatSelectionNotice({ decl, numCtx: 16384, budgetBytes: 12.3e9, installed: true });
  expect(s).toContain('qwen3.5:9b');
  expect(s).toContain('9B');
  expect(s).toContain('16384');
  expect(s).toContain('installed');
});

test('not-installed notice announces a pull', () => {
  const s = formatSelectionNotice({ decl, numCtx: 16384, budgetBytes: 12.3e9, installed: false });
  expect(s.toLowerCase()).toContain('pull');
});
```

Create `tests/cli/select-hook.test.ts`:

```ts
import { expect, mock, test } from 'bun:test';
import type { Agent } from '../../src/core/agent-def.ts';
import { ResourceError } from '../../src/core/errors.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { createSelectHook } from '../../src/cli/select-hook.ts';
import { REGISTRY } from '../../models/registry.ts';

function specialist(): Agent {
  return {
    name: 'file_qa',
    description: 'd',
    systemPrompt: 'sp',
    tools: {},
    model: undefined as never, // overridden by the hook
    modelReq: { role: 'r', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
  };
}

test('hook resolves a model + numCtx and returns a bound model', async () => {
  const ensureReady = mock(async () => 16384);
  const capture = {};
  const hook = createSelectHook({ registry: REGISTRY, ensureReady, pinned: ['qwen3.5:4b'], capture });
  const pre = await hook(specialist());
  expect(pre && 'model' in pre && pre.model).toBeTruthy();
  expect(pre && 'numCtx' in pre && pre.numCtx).toBe(16384);
});

test('hook records ResourceError into capture and returns abort', async () => {
  const ensureReady = mock(async () => {
    throw new ResourceError('no fit');
  });
  const capture: { error?: ResourceError } = {};
  const hook = createSelectHook({ registry: REGISTRY, ensureReady, pinned: ['qwen3.5:4b'], capture });
  const pre = await hook(specialist());
  expect(capture.error).toBeInstanceOf(ResourceError);
  expect(pre && 'abort' in pre && pre.abort).toBeTruthy();
});

test('agent without modelReq is a no-op', async () => {
  const ensureReady = mock(async () => 0);
  const hook = createSelectHook({ registry: REGISTRY, ensureReady, pinned: [], capture: {} });
  const pre = await hook({ name: 'x', description: 'd', systemPrompt: 's', tools: {}, model: undefined as never });
  expect(pre).toEqual({});
  expect(ensureReady).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/selection-notice.test.ts tests/cli/select-hook.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the notice formatter**

Create `src/cli/selection-notice.ts`:

```ts
import type { ModelDeclaration } from '../core/types.ts';
import { kvCacheBytes, weightsBytes } from '../resource/footprint.ts';

const DEFAULT_KV_PER_TOKEN = 131072;
const gb = (b: number): string => (b / 1e9).toFixed(1);

export type NoticeInput = {
  decl: ModelDeclaration;
  numCtx: number;
  budgetBytes: number;
  installed: boolean;
};

/** Human-readable heads-up about the model chosen for a delegation. */
export function formatSelectionNotice(i: NoticeInput): string {
  const f = i.decl.footprint;
  const w = weightsBytes(f.approxParamsBillions, f.bytesPerWeight);
  const kv = kvCacheBytes(i.numCtx, f.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN);
  const install = i.installed ? 'installed' : 'not installed — will pull';
  return [
    `▸ selected ${i.decl.model}`,
    `  ${f.approxParamsBillions}B · weights ≈${gb(w)}GB + KV ≈${gb(kv)}GB @ up to ${i.numCtx} ctx = ≈${gb(w + kv)}GB`,
    `  live budget ≈${gb(i.budgetBytes)}GB · ${install}`,
  ].join('\n');
}
```

- [ ] **Step 4: Implement the select-hook factory**

Create `src/cli/select-hook.ts`:

```ts
import type { Agent } from '../core/agent-def.ts';
import type { BeforeDelegate } from '../core/delegate.ts';
import { ResourceError } from '../core/errors.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { createOllamaModel } from '../providers/ollama.ts';
import type { EnsureOpts } from '../resource/model-manager.ts';
import type { LoadedModel } from '../resource/ollama-control.ts';
import { resolveModel } from '../resource/selector.ts';

export type SelectHookDeps = {
  registry: ModelDeclaration[];
  ensureReady: (d: ModelDeclaration, o?: EnsureOpts) => Promise<number>;
  pinned: string[];
  capture: ResourceCapture;
  listLoaded?: () => Promise<LoadedModel[]>;
  /** Fired before each ensureReady attempt (e.g. to print a selection notice). */
  onAttempt?: (decl: ModelDeclaration) => void | Promise<void>;
};

/**
 * Build the onBeforeDelegate hook: resolve the agent's requirement live, bind the
 * chosen model + numCtx, and on a genuine no-fit record it in `capture` and abort
 * the delegation (rather than letting the AI SDK swallow the error).
 */
export function createSelectHook(deps: SelectHookDeps): BeforeDelegate {
  return async (agent: Agent) => {
    if (!agent.modelReq) return {};
    try {
      const { decl, numCtx } = await resolveModel(
        agent.modelReq,
        deps.registry,
        {
          ensureReady: deps.ensureReady,
          listLoaded: deps.listLoaded,
          onAttempt: deps.onAttempt,
        },
        { pinned: deps.pinned },
      );
      return { model: createOllamaModel(decl), numCtx };
    } catch (err) {
      if (err instanceof ResourceError) {
        deps.capture.error = err;
        return { abort: "Can't run this now — no model fits in available memory." };
      }
      throw err;
    }
  };
}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `bun test tests/cli/selection-notice.test.ts tests/cli/select-hook.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire the hook into `chat.ts`**

In `src/cli/chat.ts`, replace the inline `onBeforeDelegate` (lines 27-38) and the `runChat` call so the CLI uses the selector + capture + notice. The full new `main` body between manager creation and the `fileServer` mount:

```ts
import { createSuperAgent } from '../../agents/super.ts';
import { REGISTRY } from '../../models/registry.ts';
import qwenRouter from '../../models/qwen-router.ts';
import type { ModelDeclaration } from '../core/types.ts';
import type { ResourceCapture } from '../core/resource-capture.ts';
import { createFetchTools, createFileTools } from '../mcp/client.ts';
import { createModelManager, MIN_CTX } from '../resource/model-manager.ts';
import { isModelInstalled, listLoadedModels } from '../resource/ollama-control.ts';
import { liveBudgetBytes } from '../resource/hardware.ts';
import { isProjectStoreActive } from '../resource/model-store.ts';
import { createSelectHook } from './select-hook.ts';
import { formatSelectionNotice } from './selection-notice.ts';
import { runChat } from './run-chat.ts';
```

Replace lines 27-38 (`const onBeforeDelegate = ...`) with:

```ts
  // Capture seam: a genuine no-fit during delegation is recorded here and surfaced
  // by runOrchestrator as kind:'resource' instead of being swallowed.
  const capture: ResourceCapture = {};

  // Announce each NEW model decision (size, context, footprint, install state) once.
  const announced = new Set<string>();
  const notify = async (decl: ModelDeclaration): Promise<void> => {
    if (announced.has(decl.model)) return;
    announced.add(decl.model);
    const [installed, budget] = await Promise.all([
      isModelInstalled(decl.model),
      liveBudgetBytes(),
    ]);
    console.error(
      formatSelectionNotice({
        decl,
        numCtx: decl.params.numCtx ?? MIN_CTX,
        budgetBytes: budget,
        installed,
      }),
    );
  };

  const onBeforeDelegate = createSelectHook({
    registry: REGISTRY,
    ensureReady: (decl, opts) => manager.ensureReady(decl, opts),
    listLoaded: () => listLoadedModels(),
    pinned: [qwenRouter.model],
    capture,
    onAttempt: notify,
  });
```

Update the `runChat` call to pass `capture`:

```ts
      const result = await runChat({
        orchestrator,
        task,
        runsRoot: 'runs',
        runId: `run-${process.pid}`,
        routerNumCtx,
        capture,
      });
```

Replace the final print so a resource failure exits non-zero:

```ts
      if (result.kind === 'answer') {
        console.log(result.text);
      } else if (result.kind === 'gap') {
        console.log(result.message);
      } else {
        console.error(result.message);
        process.exitCode = 1;
      }
```

- [ ] **Step 7: Typecheck + lint + full regression**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun run lint:file -- "src/cli/chat.ts" "src/cli/select-hook.ts" "src/cli/selection-notice.ts" "src/resource/selector.ts"`
Expected: clean.

Run: `bun test`
Expected: PASS — all unit tests; live tests auto-skip without Ollama.

- [ ] **Step 8: Commit**

```bash
git add src/cli/selection-notice.ts src/cli/select-hook.ts src/cli/chat.ts tests/cli/selection-notice.test.ts tests/cli/select-hook.test.ts
git commit -m "feat(cli): selector-driven delegation hook + selection notice + resource exit"
```

---

### Task 8: Live verification + documentation

**Files:**
- Create: `tests/integration/selection.live.test.ts`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `resolveModel` (Task 3), `REGISTRY` (Task 1), `createModelManager`, `ollamaReady` helper, `qwen-fast` requirement.

- [ ] **Step 1: Write the live test**

Create `tests/integration/selection.live.test.ts`:

```ts
import { afterAll, describe, expect, test } from 'bun:test';
import { REGISTRY } from '../../models/registry.ts';
import qwenFast from '../../models/qwen-fast.ts';
import { Capability, PreferPolicy } from '../../src/core/types.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import { resolveModel } from '../../src/resource/selector.ts';
import { unloadModel } from '../../src/resource/ollama-control.ts';
import { ollamaReady } from './ollama-available.ts';

const ready = await ollamaReady(qwenFast.model);

describe.skipIf(!ready)('live dynamic model selection (real Ollama)', () => {
  afterAll(async () => {
    await unloadModel(qwenFast.model);
  });

  test('with plentiful RAM, largest-that-fits resolves to the 9b specialist', async () => {
    const manager = createModelManager();
    const { decl, numCtx } = await resolveModel(
      { role: 'general reasoning + tool use', requires: [Capability.Tools], prefer: PreferPolicy.LargestThatFits },
      REGISTRY,
      { ensureReady: (d, o) => manager.ensureReady(d, o) },
    );
    expect(decl.model).toBe('qwen3.5:9b');
    expect(numCtx).toBeGreaterThanOrEqual(4096);
  }, 180_000);
});
```

- [ ] **Step 2: Run the live test (best-effort)**

Run: `bun test tests/integration/selection.live.test.ts`
Expected (Ollama down): SKIP. Expected (Ollama up + 9b pulled, ample free RAM): PASS — resolves `qwen3.5:9b`. If RAM is tight and it degrades to `qwen3.5:4b`, that is correct behavior — note it and adjust the assertion only if the machine genuinely cannot hold 9b.

- [ ] **Step 3: Update README**

In `README.md`, in the capabilities/how-it-works section, add a short paragraph:

> **Dynamic model selection (Slice 5).** Specialists declare a *capability requirement* (`requires: [tools]`, `prefer: largest-that-fits`) rather than a fixed model. At each delegation the selector picks the largest registry model that fits the **live** memory budget (degrading 9b→4b under pressure), prints a one-line notice (size · context · footprint · installed/pulling · budget), and the Model Manager loads it. If nothing fits, the run ends with an honest `resource` message and a non-zero exit instead of a hallucinated answer. The registry is a machine-adaptive bootstrap ladder that Slice 6 discovery will populate at runtime.

- [ ] **Step 4: Update architecture doc**

In `docs/architecture.md`, in the resource/model-manager section, add:

> **Selector (`src/resource/selector.ts`).** `selectCandidates` (pure: capability hard-filter + largest-that-fits rank + warm-aware tie-break) feeds `resolveModel`, a live fallback loop that walks candidates best-first against `manager.ensureReady` (the single fit-authority). The chosen model is bound lazily at delegation time via `onBeforeDelegate` (`src/cli/select-hook.ts`). A genuine no-fit is recorded in a `ResourceCapture` seam and surfaced by `runOrchestrator` as `{kind:'resource'}`.

- [ ] **Step 5: Mark Slice 5 shipped + carry forward Future Work in ROADMAP**

In `docs/ROADMAP.md`: move Slice 5 into the **Shipped** table; remove the "Slice 5 is the next active slice" note; and add a **Future Work (from Slice 5 brainstorm)** subsection capturing every committed item — global/lookahead scheduler (needs a task planner/DAG), parallel-fan-out memory arbitration (+ explicit `maxLoaded`), interactive resource arbitration ("user takes calls", overlaps Reclaim 4.5), quality-ranked selection (Slice 6 signal), richer registry + discovery (Slice 6), router-as-selected, and fuller anti-churn/hysteresis. Reference the spec's §8.

- [ ] **Step 6: Typecheck + full suite**

Run: `bun run typecheck && bun test`
Expected: typecheck clean; all unit tests pass; live tests pass or skip.

- [ ] **Step 7: Commit**

```bash
git add tests/integration/selection.live.test.ts README.md docs/architecture.md docs/ROADMAP.md
git commit -m "test(resource): live selection verify + docs for Slice 5"
```

---

## Final review (whole-branch)

After Task 8, run the project's pre-PR gate and a whole-branch review:

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun test` (note pass/skip counts)
- [ ] Dispatch code-review subagents across dimensions (correctness, types, silent-failures, tests) per the standing workflow; apply verified findings.

---

## Self-review (plan vs spec)

**Spec coverage:**
- §1 decision 1 (live per-delegation) → Tasks 4, 7. ✓
- §1 decision 2 (largest-that-fits) → Task 2. ✓
- §1 decision 3 (registry 4b+9b; router fixed) → Task 1 (router untouched, specialists carry `modelReq`). ✓
- §1 decision 4 + §5 (capture-and-check `{kind:'resource'}`, S5-DEBT-1) → Task 6 (+ abort in Task 4, hook in Task 7). ✓
- §1 decision 5 / §3.4 (selection notice, warm-aware bias) → Task 2 (bias) + Task 7 (notice). ✓
- §2 types (`Capability`, `PreferPolicy`, `ModelRequirement`, `capabilities`) → Task 1. ✓ (`numCtx` intentionally omitted — see Design note.)
- §3.1 registry → Task 1; §3.2 selector → Tasks 2-3; §3.3 lazy binding → Tasks 4-5. ✓
- §6 S5-DEBT-2 → unchanged upstream; exercised by Task 3 fallback + Task 8 live. ✓
- §7 testing → unit Tasks 2,3,4,6,7; live Task 8. ✓
- §8 Future Work → recorded in ROADMAP at Task 8 Step 5. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `selectCandidates`/`resolveModel`/`ResolveDeps`/`ResourceCapture`/`createSelectHook`/`formatSelectionNotice`/`NoticeInput` signatures match across tasks; `BeforeDelegate` return (`numCtx?`, `model?`, `abort?`) and `runDefinedAgent(agent, task, numCtx?, modelOverride?)` consistent between Tasks 4 and 7. ✓
