# Slice 9 — Composition Guardrails — design

**Date:** 2026-06-30
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 2 (orchestrator + delegation), Slice 4–7 (Model Manager + live dynamic `num_ctx`), Slice 8 (OTel telemetry layer + AsyncLocalStorage context manager)
**Feeds:** Phase B Workflow/DAG engine + Crews + agent-builder — this is their **safe-composition prerequisite** (the roadmap mandates guardrails land *before* crews/agent-builder, or deep graphs become a cost/loop footgun, ~15× compounding).

---

## 1. Problem & goal

The roadmap's "Composition guardrails" item: **delegation depth limit + cross-agent cycle detection + concise/summarized returns + warm-model reuse** — "Prerequisite for any multi-agent depth … they must land **before** crews/agent-builder."

Current reality (verified by exploration), which scopes the work precisely:

- **Multi-hop delegation is NOT reachable today.** Only the orchestrator carries `delegate_to_*` tools (built in `createOrchestrator`); specialists carry only their domain tools. Delegation is strictly **one hop** — *yet*. The workflow/crew engine + agent-builder will introduce multi-hop, so we build + unit-test the guards **now** (with synthetic multi-hop agents) so the engine inherits safe composition.
- **Each delegation is a fresh, isolated instance.** `runDefinedAgent(agent, task)` is a new `generateText` with its own system prompt + task and **no shared mutable state** with its caller — like a fresh call-stack frame. So "cycles" are **not** a state-corruption problem; the only risks are **non-termination** (A→B→A… each fresh instance re-makes the same decision) and **cost**. A **depth limit bounds both**, like bounding call-stack depth, and does NOT forbid legitimate recursive decomposition (planner→planner on a smaller sub-task). Name-based cycle detection would ban all such recursion, so we deliberately **do not** do it; depth subsumes it. (Ancestry is tracked for telemetry only.)
- **Delegated returns flow back verbatim, uncapped.** `delegate.ts` returns `{ text }` with no size limit; the orchestrator can call `delegate_to_*` up to `maxSteps = 10` times, accumulating every full answer in its context. A **live** cost gap even at one hop.
- **Warm-model reuse is already satisfied.** The Model Manager keys all state by the `model` string + has an "already loaded" fast path; the selector biases toward resident models. → **No new code; lock it in with a regression test.**

The only existing bound is `DEFAULT_MAX_STEPS = 10` per agent invocation (`src/core/agent.ts:11`).

### Locked decisions
1. **Scope = full proactive guardrails** — build the enforcement seam + policy now, unit-tested with synthetic multi-hop; the engine slice inherits it.
2. **Mechanism = AsyncLocalStorage.** Depth/ancestry/budget cannot be threaded as params (the orchestrator's `generateText` is opaque between the LLM tool-call and the tool's `execute`, and the tool closure is built once). An ambient `AsyncLocalStorage<DelegationContext>` is the clean, essentially-only way; it auto-propagates across hops. (Same async-context substrate Slice 8 registered for OTel.)
3. **Depth limit = 5, the single termination + cost guarantee. NO name-based cycle detection (recursion allowed).** Reject a delegation when would-be depth (`current.depth + 1`) `> max`. Each instance is isolated, so depth alone guarantees termination and bounds cost while permitting recursive decomposition. `max` env-overridable via `AGENT_MAX_DELEGATION_DEPTH` (default 5, fallback-only). Ancestry recorded for telemetry, not rejection.
4. **Concise returns = a LIVE cap, computed from the caller's context budget — not a magic constant** (consistent with the project's compute-live / env-fallback-only philosophy: live RAM budget, dynamic `num_ctx`, arch-probed KV). A delegated return is injected into the **caller's** (consuming agent's) context window, so the cap is a **fraction of the caller's `num_ctx`**, converted tokens→chars: `cap = floor(fraction × callerNumCtx × CHARS_PER_TOKEN)`. `fraction` = `AGENT_RETURN_CTX_FRACTION` (default **0.25**, fallback-only); `CHARS_PER_TOKEN = 4` is a unit-conversion constant (English ≈ 4 chars/token), **not** a tunable budget — the budget is `num_ctx`, computed live by the Model Manager. The caller's `num_ctx` rides the same ALS context. When unknown, fall back to a conservative `4096`. No absolute char ceiling. LLM summarization deferred to the RAG/verification slice.
5. **Violations surface as a SOFT error** (`{ error }` from the delegate tool — the existing soft-tool-error path) so the calling agent SEES it and can adapt, rather than killing the run. Plus a guardrail span event. No new error class (the soft path is a string — YAGNI).
6. **Telemetry-to-emit (mandated):** an `agent.guardrail.violation` span event on the delegation span (type = `depth_exceeded`), plus `agent.delegation.depth` and `agent.delegation.ancestors` attributes on every delegation span (depth + chain visible in `bun run runs`).
7. **Architecture-doc update (mandated, [[feedback-living-architecture-viz]]):** this slice adds the guardrail layer to the delegation data-flow; the living `docs/ARCHITECTURE.md` (built right after this slice) must reflect it.

---

## 2. Components

### 2.1 `src/core/guardrails.ts` (new — policy + ambient context; no resource-layer import)
```ts
import { AsyncLocalStorage } from 'node:async_hooks';

/** The running agent's context budget rides the same context as depth/ancestry. */
export type DelegationContext = { depth: number; ancestors: string[]; numCtx?: number };

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
  return storage.run({ depth: depth + 1, ancestors: [...ancestors, target], numCtx }, fn);
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

### 2.2 `src/telemetry/spans.ts` (extend)
- `ATTR` gains: `GUARDRAIL_TYPE: 'agent.guardrail.type'`, `DELEGATION_DEPTH: 'agent.delegation.depth'`, `DELEGATION_ANCESTORS: 'agent.delegation.ancestors'`.
- New helper (mirrors `recordEvict`); `type` kept a union for future guard kinds (only `depth_exceeded` emitted now):
  ```ts
  export function recordGuardrailViolation(type: 'depth_exceeded', detail: string): void {
    const span = trace.getActiveSpan();
    if (!span) return;
    span.addEvent('agent.guardrail.violation', { [ATTR.GUARDRAIL_TYPE]: type, 'agent.guardrail.detail': detail });
  }
  ```
- `withDelegationSpan` additionally sets, from `currentDelegationContext()` (import from `../core/guardrails.ts`): `ATTR.DELEGATION_DEPTH = depth + 1` and `ATTR.DELEGATION_ANCESTORS = [...ancestors, target].join(' → ')`.

### 2.3 `src/core/delegate.ts` (wire at the single chokepoint)
Inside `asDelegateTool`'s `execute`, within `withDelegationSpan(agent.name, …)`:
```ts
execute: async ({ task }) =>
  withDelegationSpan(agent.name, async () => {
    const check = checkDelegation(agent.name);
    if (!check.ok) {
      recordGuardrailViolation(check.kind, check.reason);
      return { error: check.reason };
    }
    const callerNumCtx = currentDelegationContext().numCtx; // parent budget, before entering child
    try {
      const pre = onBeforeDelegate ? await onBeforeDelegate(agent) : undefined;
      if (pre?.abort) return { error: pre.abort };
      const { text } = await runInDelegationContext(agent.name, pre?.numCtx, () =>
        runDefinedAgent(agent, task, pre?.numCtx, pre?.model),
      );
      return { text: concise(text, callerNumCtx) };
    } catch (cause) {
      return { error: `Agent ${agent.name} failed: ${(cause as Error).message}` };
    }
  }),
```
Imports from `./guardrails.ts`: `checkDelegation`, `currentDelegationContext`, `runInDelegationContext`, `concise`; from `../telemetry/spans.ts`: `recordGuardrailViolation` (+ existing `withDelegationSpan`).

### 2.4 `src/core/orchestrator.ts` (seed the root budget)
In `runOrchestrator`, wrap the orchestrator run so its delegations cap returns against the orchestrator's real `num_ctx`:
```ts
const result = await withRootDelegationContext(numCtx, () =>
  runDefinedAgent(orchestrator, task, numCtx),
);
```
(import `withRootDelegationContext` from `./guardrails.ts`). `numCtx` is `runOrchestrator`'s existing param (the orchestrator's chosen/desired context). If undefined, `concise` falls back to `FALLBACK_CTX`.

### 2.5 Warm-model reuse — NO new code
Locked in by a regression test (§5). The manager already dedups by `model` string.

---

## 3. Data flow
```
runOrchestrator(numCtx = router ctx)
  → withRootDelegationContext(numCtx)         root frame carries the orchestrator's budget
    → orchestrator.generateText
      → delegate_to_X.execute
        → withDelegationSpan(X)                tags delegation.depth=1, ancestors="X"
          → checkDelegation(X)                 ambient depth 0 → ok (depth-only; recursion allowed)
          → callerNumCtx = ctx.numCtx          = orchestrator's budget
          → runInDelegationContext(X, Xctx){depth1,[X],numCtx:Xctx}
            → runDefinedAgent(X)               (if X delegates to Y: caps Y's return by Xctx)
          → return { text: concise(text, callerNumCtx) }   cap = ¼ × orchestrator ctx × 4 chars/token
```
A delegation that would make `depth + 1 > 5` returns `{ error }` (soft) + emits `agent.guardrail.violation`. Repeated agent names are NOT rejected — depth is the bound. Each return is capped against **its consumer's** live `num_ctx`.

---

## 4. Error handling & the termination guarantee
- **No infinite recursion / no unbounded stack (the core guarantee).** Every hop goes through `runInDelegationContext`, which increments `depth`; `checkDelegation` rejects the *next* hop once `depth + 1 > max`. So any chain terminates after at most `max` (=5) levels — like a bounded call stack. Total work is bounded: **≤ `maxDelegationDepth` levels × `maxSteps` (10) tool-steps per agent.** Holds even for self-recursion (A→A→A…): the depth counter still climbs and stops it. The guarantee rests on `AsyncLocalStorage` propagating depth across the `generateText`→tool boundary — which Slice 8 verified works on Bun — and is re-proven here by the synthetic over-depth test. (Async recursion unwinds the JS stack at each `await`, so the practical no-cap failure mode is unbounded *cost/time*, not a sync stack overflow; the depth cap bounds both.)
- Violations are **soft**: `{ error }` string; no throw; the caller's LLM adapts. No new error class.
- `concise()` / `returnCapChars()` are pure and total. `AsyncLocalStorage.run` restores the prior context on return and throw. Telemetry helpers never throw (guarded `getActiveSpan`). Env parsing falls back to defaults on any out-of-range input.

---

## 5. Testing (TDD)
- **`tests/core/guardrails.test.ts`** (pure unit):
  - depth: from root allows depth 1; nested via `runInDelegationContext` up to depth 5 allows, depth 6 → `depth_exceeded`.
  - **recursion allowed**: re-entering the same target name at a permitted depth returns `ok: true`.
  - `returnCapChars`: `returnCapChars(8192) === 8192` (0.25×8192×4); `returnCapChars(undefined) === 4096` (fallback 4096); with `AGENT_RETURN_CTX_FRACTION=0.5`, `returnCapChars(8192) === 16384` (set/restore env).
  - `concise`: under-cap passthrough; over-cap → `slice(0,cap)` + `…[truncated, N chars omitted]`, cap derived from the passed `callerNumCtx`.
  - **ALS propagation**: `runInDelegationContext('A', 1000, () => runInDelegationContext('B', 2000, async () => currentDelegationContext()))` ⇒ `{depth:2, ancestors:['A','B'], numCtx:2000}`; context restored to root after.
- **`tests/core/delegate.test.ts`** (integration, synthetic multi-hop): build an agent whose `tools` include an `asDelegateTool` wrapping another agent. Drive (via `withRootDelegationContext(knownCtx, …)` to set a known caller budget): (a) over-depth chain → deep `execute` returns soft `{error}` + `agent.guardrail.violation` event (assert via `registerTestProvider()` InMemory exporter); (b) a long specialist return → truncated to `returnCapChars(knownCtx)` with the marker; (c) within-depth recursive re-entry of the same agent succeeds. Use `MockLanguageModelV3`.
- **`tests/telemetry/spans.test.ts`** (extend): `recordGuardrailViolation('depth_exceeded', …)` adds the event to the active span; `withDelegationSpan` sets `agent.delegation.depth`/`agent.delegation.ancestors` (use `registerTestProvider()`).
- **`tests/resource/*.test.ts`** (warm-reuse regression): with a fake `RuntimeControl` whose `warm` is a `mock` and whose `listLoaded` reflects warmed models, call `ensureReady` twice for two declarations sharing `model: 'X'` → `warm` called once; second resolve hits the already-loaded fast path. Locks in the existing behavior. (Harness mirrors `tests/resource/model-manager.test.ts`: `fakeControl`/`fakes` + `createModelManager`.)

---

## 6. Out of scope (deferred)
- **Name-based cycle detection** — deliberately NOT done; depth bounds recursion and banning name repeats would forbid legitimate recursive decomposition. A cheap exact-`(agent,task)`-repeat guard can be added with the engine if non-progressing loops prove real.
- **LLM summarization** of returns (Phase-B RAG/verification slice) — the deterministic live cap stands in for now.
- **Hard-fail mode**; **per-agent step budgets** beyond `maxSteps=10`; **a unified config module**; the **workflow/crew engine** itself.

---

## 7. Acceptance
- `bun run typecheck`, `bun run lint`, `bun test` green (live tests skip when Ollama is down).
- A delegation exceeding depth 5 returns a soft `{ error }` + emits `agent.guardrail.violation` (synthetic multi-hop test + InMemory exporter).
- A within-depth recursive re-entry of the same agent is **allowed**.
- A long delegated return is truncated to `floor(0.25 × callerNumCtx × 4)` chars with the marker; a short one is unchanged; the cap **scales with the caller's live `num_ctx`** (no flat constant).
- Two agents sharing a model resolve to one warm load (regression test).
- `agent.delegation.depth` and `agent.delegation.ancestors` appear on delegation spans in `bun run runs`.
- No regression to single-hop orchestration (existing orchestrator/delegate tests pass).
