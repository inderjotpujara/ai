# Composition Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add proactive composition guardrails — a delegation depth limit (the single termination guarantee), a LIVE per-return size cap derived from the caller's `num_ctx`, soft-error surfacing, and a warm-model-reuse regression test — so the Phase-B workflow/crew engine inherits safe multi-agent composition.

**Architecture:** A small `src/core/guardrails.ts` policy module backed by `AsyncLocalStorage<DelegationContext>` (the only mechanism that survives the opaque `generateText`→tool-`execute` boundary), enforced at the single delegation chokepoint (`delegate.ts`), with the root context seeded from the orchestrator's `num_ctx` (`orchestrator.ts`). Warm-reuse is already satisfied by the Model Manager — locked in by a regression test, no new code.

**Tech Stack:** TypeScript on Bun; `node:async_hooks` AsyncLocalStorage; AI SDK `ai@6.0.214`; OpenTelemetry (existing `src/telemetry/`); `bun:test`; Biome.

## Global Constraints

- **Runtime:** Bun. Style (Biome): single quotes, always semicolons, 2-space indent, `.ts` import extensions, `import type` for type-only imports, `strict` + `noUncheckedIndexedAccess`. **No non-null assertions** (`x!`) — Biome `noNonNullAssertion` errors; use guards/`?.`. Prefer `enum` for finite named sets; discriminated unions stay `type`.
- **Compute-live, env fallback-only:** the return cap is computed from the caller's live `num_ctx`; env vars are fallbacks only. `AGENT_MAX_DELEGATION_DEPTH` (default 5), `AGENT_RETURN_CTX_FRACTION` (default 0.25). `CHARS_PER_TOKEN = 4` is a unit-conversion constant, not a tunable budget.
- **Depth-only termination:** depth limit is the single guarantee; **recursion (repeated agent names) is allowed** — do NOT add name-based cycle rejection. Reject when `current.depth + 1 > maxDelegationDepth()`.
- **Guardrails never throw into the run path:** violations return a SOFT `{ error: string }` from the delegate tool; `AsyncLocalStorage.run` restores context on return/throw; telemetry helpers guard `getActiveSpan()`.
- **Layering:** `src/core/guardrails.ts` must NOT import from `src/resource/*` — define a local `FALLBACK_CTX = 4096`, don't import `MIN_CTX`.
- **Tests:** `bun:test`; `MockLanguageModelV3` from `ai/test` (doGenerate shape: `{ content:[{type:'text',text}], finishReason:{unified:'stop',raw:undefined}, usage:{inputTokens:{total,noCache,cacheRead,cacheWrite}, outputTokens:{total,text,reasoning}}, warnings:[] }`); register OTel providers in tests via `registerTestProvider()` from `tests/helpers/otel-test-provider.ts` (NOT inline `setGlobalTracerProvider`). Set/restore any env var you mutate within the test.
- **Every commit message ends with:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Gates:** `bun run typecheck` + `bun run lint` clean; `bun test` green (live tests skip when Ollama is down). Run the full `bun test` before committing any task that touches `delegate.ts`/`orchestrator.ts`.

---

## File Structure

**Create:**
- `src/core/guardrails.ts` — ALS delegation context + policy (`checkDelegation`, `runInDelegationContext`, `withRootDelegationContext`, `concise`, `returnCapChars`, limit getters).
- `tests/core/guardrails.test.ts` — pure unit tests.

**Modify:**
- `src/telemetry/spans.ts` — add `ATTR` keys + `recordGuardrailViolation` + depth/ancestors tagging in `withDelegationSpan`.
- `tests/telemetry/spans.test.ts` — assert the new event + delegation attrs.
- `src/core/delegate.ts` — wire the chokepoint (check → context → concise).
- `tests/core/delegate.test.ts` — synthetic multi-hop integration tests.
- `src/core/orchestrator.ts` — seed the root delegation context with the orchestrator's `num_ctx`.

**Create (test-only):**
- `tests/resource/warm-reuse.test.ts` — warm-model-reuse regression.

---

### Task 1: `src/core/guardrails.ts` — policy + ambient context

**Files:**
- Create: `src/core/guardrails.ts`
- Test: `tests/core/guardrails.test.ts`

**Interfaces:**
- Produces: `type DelegationContext = { depth: number; ancestors: string[]; numCtx?: number }`; `currentDelegationContext()`; `maxDelegationDepth()`; `returnCtxFraction()`; `returnCapChars(callerNumCtx: number | undefined): number`; `type DelegationCheck = { ok: true } | { ok: false; kind: 'depth_exceeded'; reason: string }`; `checkDelegation(target: string): DelegationCheck`; `runInDelegationContext<T>(target: string, numCtx: number | undefined, fn: () => Promise<T>): Promise<T>`; `withRootDelegationContext<T>(numCtx: number | undefined, fn: () => Promise<T>): Promise<T>`; `concise(text: string, callerNumCtx: number | undefined): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/core/guardrails.test.ts`:
```ts
import { afterEach, expect, test } from 'bun:test';
import {
  checkDelegation,
  concise,
  currentDelegationContext,
  returnCapChars,
  runInDelegationContext,
  withRootDelegationContext,
} from '../../src/core/guardrails.ts';

afterEach(() => {
  delete process.env.AGENT_MAX_DELEGATION_DEPTH;
  delete process.env.AGENT_RETURN_CTX_FRACTION;
});

test('checkDelegation allows up to max depth and rejects beyond', async () => {
  expect(checkDelegation('A').ok).toBe(true); // root → depth 1
  // descend to depth 5 (allowed), then a 6th would exceed default max 5
  await runInDelegationContext('A', undefined, () =>
    runInDelegationContext('B', undefined, () =>
      runInDelegationContext('C', undefined, () =>
        runInDelegationContext('D', undefined, async () => {
          // currently depth 4; entering a 5th is ok, a 6th is not
          expect(checkDelegation('E').ok).toBe(true); // would be depth 5
          await runInDelegationContext('E', undefined, async () => {
            const res = checkDelegation('F'); // would be depth 6
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.kind).toBe('depth_exceeded');
          });
        }),
      ),
    ),
  );
});

test('recursion (repeated agent name) is allowed within depth', async () => {
  await runInDelegationContext('A', undefined, async () => {
    expect(checkDelegation('A').ok).toBe(true); // same name again → not rejected
  });
});

test('returnCapChars is live: fraction × num_ctx × 4, with fallback + env override', () => {
  expect(returnCapChars(8192)).toBe(8192); // 0.25 * 8192 * 4
  expect(returnCapChars(undefined)).toBe(4096); // fallback ctx 4096 → 0.25*4096*4
  process.env.AGENT_RETURN_CTX_FRACTION = '0.5';
  expect(returnCapChars(8192)).toBe(16384);
});

test('concise passes short text and truncates long text with a marker', () => {
  expect(concise('short', 8192)).toBe('short');
  const long = 'x'.repeat(9000);
  const out = concise(long, 8192); // cap 8192
  expect(out.startsWith('x'.repeat(8192))).toBe(true);
  expect(out).toContain('…[truncated, 808 chars omitted]');
});

test('delegation context propagates depth/ancestors/numCtx and restores after', async () => {
  const inner = await runInDelegationContext('A', 1000, () =>
    runInDelegationContext('B', 2000, async () => currentDelegationContext()),
  );
  expect(inner).toEqual({ depth: 2, ancestors: ['A', 'B'], numCtx: 2000 });
  expect(currentDelegationContext()).toEqual({ depth: 0, ancestors: [] });
});

test('withRootDelegationContext seeds depth 0 with a budget', async () => {
  const ctx = await withRootDelegationContext(4096, async () =>
    currentDelegationContext(),
  );
  expect(ctx).toEqual({ depth: 0, ancestors: [], numCtx: 4096 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/guardrails.test.ts`
Expected: FAIL — cannot resolve `../../src/core/guardrails.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/guardrails.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';

/** The running agent's context budget rides the same context as depth/ancestry. */
export type DelegationContext = {
  depth: number;
  ancestors: string[];
  numCtx?: number;
};

const storage = new AsyncLocalStorage<DelegationContext>();
const ROOT: DelegationContext = { depth: 0, ancestors: [] };

/** ~chars per token (English approximation). A unit conversion, not a tunable budget. */
const CHARS_PER_TOKEN = 4;
/** Conservative context floor when a caller's num_ctx is unknown (mirrors Model Manager MIN_CTX). */
const FALLBACK_CTX = 4096;

export function currentDelegationContext(): DelegationContext {
  return storage.getStore() ?? ROOT;
}

/** Max delegation depth. Env AGENT_MAX_DELEGATION_DEPTH (fallback-only), default 5. */
export function maxDelegationDepth(): number {
  const raw = Number(process.env.AGENT_MAX_DELEGATION_DEPTH);
  return Number.isInteger(raw) && raw > 0 ? raw : 5;
}

/** Fraction of the caller's context a single return may occupy. Env AGENT_RETURN_CTX_FRACTION, default 0.25. */
export function returnCtxFraction(): number {
  const raw = Number(process.env.AGENT_RETURN_CTX_FRACTION);
  return raw > 0 && raw <= 1 ? raw : 0.25;
}

/** LIVE char cap for a return consumed by an agent with `callerNumCtx` tokens of context. */
export function returnCapChars(callerNumCtx: number | undefined): number {
  const ctx = callerNumCtx && callerNumCtx > 0 ? callerNumCtx : FALLBACK_CTX;
  return Math.floor(returnCtxFraction() * ctx * CHARS_PER_TOKEN);
}

export type DelegationCheck =
  | { ok: true }
  | { ok: false; kind: 'depth_exceeded'; reason: string };

/** Depth-only: recursion (a repeated agent name) is permitted; depth bounds it. */
export function checkDelegation(target: string): DelegationCheck {
  const { depth, ancestors } = currentDelegationContext();
  if (depth + 1 > maxDelegationDepth()) {
    return {
      ok: false,
      kind: 'depth_exceeded',
      reason: `Delegation depth limit (${maxDelegationDepth()}) exceeded at '${target}' (chain: ${[...ancestors, target].join(' → ')}).`,
    };
  }
  return { ok: true };
}

/** Run `fn` inside the context for entering `target`, recording the budget `numCtx` that target runs with. */
export function runInDelegationContext<T>(
  target: string,
  numCtx: number | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const { depth, ancestors } = currentDelegationContext();
  return storage.run(
    { depth: depth + 1, ancestors: [...ancestors, target], numCtx },
    fn,
  );
}

/** Seed the root context with the top agent's (orchestrator's) context budget. */
export function withRootDelegationContext<T>(
  numCtx: number | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ depth: 0, ancestors: [], numCtx }, fn);
}

/** Cap a return to returnCapChars(callerNumCtx) with a clear truncation marker. */
export function concise(text: string, callerNumCtx: number | undefined): string {
  const cap = returnCapChars(callerNumCtx);
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n…[truncated, ${text.length - cap} chars omitted]`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/guardrails.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- src/core/guardrails.ts tests/core/guardrails.test.ts`
```bash
git add src/core/guardrails.ts tests/core/guardrails.test.ts
git commit -m "feat(core): composition guardrails policy + ALS delegation context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `src/telemetry/spans.ts` — guardrail event + delegation depth/ancestors

**Files:**
- Modify: `src/telemetry/spans.ts`
- Test: `tests/telemetry/spans.test.ts`

**Interfaces:**
- Consumes: `currentDelegationContext` (Task 1).
- Produces: `ATTR.GUARDRAIL_TYPE`, `ATTR.DELEGATION_DEPTH`, `ATTR.DELEGATION_ANCESTORS`; `recordGuardrailViolation(type: 'depth_exceeded', detail: string): void`; `withDelegationSpan` now also sets depth + ancestors attributes.

- [ ] **Step 1: Write the failing test**

Add to `tests/telemetry/spans.test.ts` (it already uses `registerTestProvider()`):
```ts
import {
  recordGuardrailViolation,
  withDelegationSpan,
} from '../../src/telemetry/spans.ts';
import { runInDelegationContext } from '../../src/core/guardrails.ts';

test('withDelegationSpan tags delegation depth and ancestors', async () => {
  const { exporter, provider } = registerTestProvider();
  await runInDelegationContext('A', undefined, () =>
    withDelegationSpan('B', async () => {}),
  );
  await provider.shutdown();
  const span = exporter.getFinishedSpans().find((s) => s.name === 'agent.delegation');
  expect(span?.attributes['agent.delegation.depth']).toBe(2); // inside A (depth1) → entering B → depth 2
  expect(span?.attributes['agent.delegation.ancestors']).toBe('A → B');
  exporter.reset();
});

test('recordGuardrailViolation adds a guardrail event to the active span', async () => {
  const { exporter, provider } = registerTestProvider();
  await withDelegationSpan('X', async () => {
    recordGuardrailViolation('depth_exceeded', 'too deep');
  });
  await provider.shutdown();
  const span = exporter.getFinishedSpans().find((s) => s.name === 'agent.delegation');
  const ev = span?.events.find((e) => e.name === 'agent.guardrail.violation');
  expect(ev).toBeDefined();
  expect(ev?.attributes?.['agent.guardrail.type']).toBe('depth_exceeded');
  exporter.reset();
});
```
(Match the existing import style at the top of the file; reuse the existing `registerTestProvider` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/telemetry/spans.test.ts`
Expected: FAIL — `recordGuardrailViolation` not exported / delegation depth attr undefined.

- [ ] **Step 3: Implement**

In `src/telemetry/spans.ts`:
1. Add an import at the top: `import { currentDelegationContext } from '../core/guardrails.ts';`
2. Add to the `ATTR` object (keep `as const`):
```ts
  GUARDRAIL_TYPE: 'agent.guardrail.type',
  DELEGATION_DEPTH: 'agent.delegation.depth',
  DELEGATION_ANCESTORS: 'agent.delegation.ancestors',
```
3. Update `withDelegationSpan` to tag depth + ancestors (keep the existing `DELEGATION_TARGET` line):
```ts
export function withDelegationSpan<T>(target: string, fn: () => Promise<T>): Promise<T> {
  return inSpan('agent.delegation', async (span) => {
    const { depth, ancestors } = currentDelegationContext();
    span.setAttribute(ATTR.DELEGATION_TARGET, target);
    span.setAttribute(ATTR.DELEGATION_DEPTH, depth + 1);
    span.setAttribute(ATTR.DELEGATION_ANCESTORS, [...ancestors, target].join(' → '));
    return fn();
  });
}
```
4. Add the helper (near `recordEvict`):
```ts
export function recordGuardrailViolation(type: 'depth_exceeded', detail: string): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent('agent.guardrail.violation', {
    [ATTR.GUARDRAIL_TYPE]: type,
    'agent.guardrail.detail': detail,
  });
}
```
> Note: this introduces an import from `../core/guardrails.ts` into the telemetry layer. That is acceptable (guardrails is pure, no telemetry import back — no cycle). Verify `bun run typecheck` shows no circular-import error.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/telemetry/spans.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- src/telemetry/spans.ts tests/telemetry/spans.test.ts`
```bash
git add src/telemetry/spans.ts tests/telemetry/spans.test.ts
git commit -m "feat(telemetry): guardrail violation event + delegation depth/ancestors attrs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the chokepoint — `delegate.ts` + `orchestrator.ts` root seed

**Files:**
- Modify: `src/core/delegate.ts`
- Modify: `src/core/orchestrator.ts`
- Test: `tests/core/delegate.test.ts`

**Interfaces:**
- Consumes: `checkDelegation`, `currentDelegationContext`, `runInDelegationContext`, `withRootDelegationContext`, `concise` (Task 1); `recordGuardrailViolation` (Task 2).
- Produces: depth/return guardrails enforced on every delegation; the orchestrator's `num_ctx` seeds the root context.

- [ ] **Step 1: Write the failing test**

Add to `tests/core/delegate.test.ts` (create if absent; mirror `tests/core/agent-def.test.ts` for the mock model + `tests/core/delegate` patterns). These use a synthetic multi-hop agent — an agent whose `tools` include a delegate tool wrapping a leaf agent:
```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Agent } from '../../src/core/agent-def.ts';
import { asDelegateTool } from '../../src/core/delegate.ts';
import {
  runInDelegationContext,
  withRootDelegationContext,
} from '../../src/core/guardrails.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

function textModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

function leaf(name: string, text: string): Agent {
  return { name, description: `${name} agent`, model: textModel(text), systemPrompt: 's', tools: {} };
}

let provider: { shutdown: () => Promise<void> };
beforeEach(() => {
  ({ provider } = registerTestProvider());
});
afterEach(async () => {
  await provider.shutdown();
  delete process.env.AGENT_MAX_DELEGATION_DEPTH;
});

test('over-depth delegation returns a soft error and records a guardrail event', async () => {
  process.env.AGENT_MAX_DELEGATION_DEPTH = '1'; // allow depth 1 only
  const target = leaf('deep', 'answer');
  const t = asDelegateTool(target);
  // simulate already being at depth 1 (one delegation deep) → this call would be depth 2 → rejected
  const result = await runInDelegationContext('parent', 8192, () =>
    t.execute?.({ task: 'go' }, { toolCallId: 'c', messages: [] }),
  );
  expect(result).toEqual({ error: expect.stringContaining('depth limit') });
});

test('long delegated return is truncated to the caller live cap', async () => {
  const big = 'y'.repeat(9000);
  const t = asDelegateTool(leaf('big', big));
  // caller num_ctx 8192 → cap = 0.25*8192*4 = 8192
  const result = await withRootDelegationContext(8192, () =>
    t.execute?.({ task: 'go' }, { toolCallId: 'c', messages: [] }),
  );
  expect(result.text.length).toBeLessThan(9000);
  expect(result.text).toContain('…[truncated');
});

test('within-depth recursive re-entry of the same agent name is allowed', async () => {
  const t = asDelegateTool(leaf('rec', 'ok'));
  const result = await runInDelegationContext('rec', 8192, () =>
    t.execute?.({ task: 'again' }, { toolCallId: 'c', messages: [] }),
  );
  expect(result).toEqual({ text: 'ok' }); // same name 'rec' re-entered, not rejected
});
```
> Verify the exact second-arg shape `t.execute?.(args, opts)` the installed AI-SDK `tool()` expects (check how `tests/core/delegate.test.ts` / agent tests already call a tool's `execute`, or the `ToolCallOptions` type). Adjust the call to match. The assertions on `{ text }` / `{ error }` are the contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/delegate.test.ts`
Expected: FAIL — no guardrail enforcement yet (no soft error / no truncation).

- [ ] **Step 3: Wire `delegate.ts`**

In `src/core/delegate.ts` add imports:
```ts
import { checkDelegation, concise, currentDelegationContext, runInDelegationContext } from './guardrails.ts';
import { recordGuardrailViolation, withDelegationSpan } from '../telemetry/spans.ts';
```
(`withDelegationSpan` is already imported — merge, don't duplicate.) Replace the `execute` body:
```ts
    execute: async ({ task }) =>
      withDelegationSpan(agent.name, async () => {
        const check = checkDelegation(agent.name);
        if (!check.ok) {
          recordGuardrailViolation(check.kind, check.reason);
          return { error: check.reason };
        }
        const callerNumCtx = currentDelegationContext().numCtx;
        try {
          const pre = onBeforeDelegate ? await onBeforeDelegate(agent) : undefined;
          if (pre?.abort) {
            return { error: pre.abort };
          }
          const { text } = await runInDelegationContext(agent.name, pre?.numCtx, () =>
            runDefinedAgent(agent, task, pre?.numCtx, pre?.model),
          );
          return { text: concise(text, callerNumCtx) };
        } catch (cause) {
          return { error: `Agent ${agent.name} failed: ${(cause as Error).message}` };
        }
      }),
```

- [ ] **Step 4: Seed the root in `orchestrator.ts`**

In `src/core/orchestrator.ts` `runOrchestrator`, add `import { withRootDelegationContext } from './guardrails.ts';` and wrap the orchestrator run:
```ts
    const result = await withRootDelegationContext(numCtx, () =>
      runDefinedAgent(orchestrator, task, numCtx),
    );
```
(`numCtx` is the existing param.) Leave the surrounding `try`/gap-detection logic unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/core/delegate.test.ts`
Expected: PASS (3 new).

- [ ] **Step 6: Full suite + gates + commit**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all green (live tests skip if Ollama down); existing orchestrator/delegate/run-chat tests still pass (single-hop unaffected — at the orchestrator root, depth 1 ≤ 5, no truncation unless a return exceeds ¼ of the orchestrator ctx).
```bash
git add src/core/delegate.ts src/core/orchestrator.ts tests/core/delegate.test.ts
git commit -m "feat(core): enforce depth + live return cap at the delegation chokepoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Warm-model-reuse regression test

**Files:**
- Test: `tests/resource/warm-reuse.test.ts`

**Interfaces:**
- Consumes: `createModelManager`, `MIN_CTX` (`src/resource/model-manager.ts`); `RuntimeControl` (`src/runtime/runtime.ts`); `ModelDeclaration`, `ProviderKind` (`src/core/types.ts`).

- [ ] **Step 1: Write the test**

Create `tests/resource/warm-reuse.test.ts` (harness mirrors `tests/resource/model-manager.test.ts`):
```ts
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';

let __prevKv: string | undefined;
beforeAll(() => {
  __prevKv = process.env.AGENT_KV_CACHE_TYPE;
  process.env.AGENT_KV_CACHE_TYPE = 'f16';
});
afterAll(() => {
  if (__prevKv === undefined) delete process.env.AGENT_KV_CACHE_TYPE;
  else process.env.AGENT_KV_CACHE_TYPE = __prevKv;
});

import { type ModelDeclaration, ProviderKind } from '../../src/core/types.ts';
import { createModelManager } from '../../src/resource/model-manager.ts';
import type { RuntimeControl } from '../../src/runtime/runtime.ts';

function decl(model: string, role: string): ModelDeclaration {
  return {
    provider: ProviderKind.Ollama,
    model,
    params: { numCtx: 0 },
    role,
    footprint: { approxParamsBillions: 4, bytesPerWeight: 1 },
  };
}

test('two agents sharing a model warm it once (reuse the resident copy)', async () => {
  const warmed = new Set<string>();
  const warm = mock(async (model: string) => {
    warmed.add(model);
  });
  const control: RuntimeControl = {
    isInstalled: mock(async () => true),
    pull: mock(async () => {}),
    warm,
    unload: mock(async () => {}),
    // reflect what has been warmed so far → the manager's already-loaded fast path triggers
    listLoaded: mock(async () =>
      [...warmed].map((name) => ({ name, sizeBytes: 1 })),
    ),
    getModelMax: mock(async () => 262144),
    getModelKvArch: mock(async () => undefined),
  };
  const mgr = createModelManager({
    budgetBytes: 100e9,
    warn: mock(() => {}),
    controlFor: () => control,
  });

  // Agent A and Agent B both resolve to the SAME model string 'shared:7b'.
  await mgr.ensureReady(decl('shared:7b', 'agent_a'));
  await mgr.ensureReady(decl('shared:7b', 'agent_b'));

  expect(warm).toHaveBeenCalledTimes(1); // one resident copy, not duplicated per agent
});
```

- [ ] **Step 2: Run the test**

Run: `bun test tests/resource/warm-reuse.test.ts`
Expected: PASS (the manager keys by `model` string; the second `ensureReady` hits `listLoaded().some(m => m.name === target)` and returns without a second `warm`).

- [ ] **Step 3: Typecheck, lint, commit**

Run: `bun run typecheck && bun run lint:file -- tests/resource/warm-reuse.test.ts`
```bash
git add tests/resource/warm-reuse.test.ts
git commit -m "test(resource): lock in warm-model reuse for agents sharing a model

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §1.1 scope = full proactive guardrails → Tasks 1–4. ✓
- §1.2 AsyncLocalStorage mechanism → Task 1. ✓
- §1.3 depth 5, recursion allowed, no name-cycle → Task 1 (`checkDelegation` depth-only) + Task 3 enforcement. ✓
- §1.4 LIVE return cap from caller num_ctx → Task 1 (`returnCapChars`/`concise`) + Task 3 (caller numCtx + root seed). ✓
- §1.5 soft-error surfacing → Task 3. ✓
- §1.6 telemetry (guardrail event + delegation depth/ancestors) → Task 2. ✓
- §2.1–2.4 components → Tasks 1/2/3. ✓
- §2.5 warm-reuse (no code) → Task 4. ✓
- §3 data flow (root seed → check → context → concise) → Tasks 1/3. ✓
- §4 termination guarantee → Task 1 (`checkDelegation` + depth increment) + Task 3 enforcement; re-proven by Task 3 over-depth test. ✓
- §5 testing → Tasks 1–4. ✓
- §7 acceptance → covered; full-suite gate in Task 3.

**2. Placeholder scan:** No TBD/vague items. The two `>` verify-before-save notes (AI-SDK `tool().execute` arg shape; merge-don't-duplicate the `withDelegationSpan` import) are explicit verification instructions with stated expected contracts, not deferred work.

**3. Type consistency:** `DelegationContext`/`DelegationCheck` defined in Task 1, consumed verbatim in Tasks 2/3. `returnCapChars(callerNumCtx)`/`concise(text, callerNumCtx)` signatures match across Task 1 def and Task 3 call. `recordGuardrailViolation(type, detail)` defined Task 2, called Task 3 with `check.kind` (`'depth_exceeded'`) + `check.reason`. `runInDelegationContext(target, numCtx, fn)` 3-arg form consistent across tasks. `ATTR` keys referenced by string-equal literals in tests.

**Note for executor:** `tests/core/delegate.test.ts` may already exist (Slice 8 added a delegation-span test) — ADD to it, don't overwrite; keep existing tests passing.
