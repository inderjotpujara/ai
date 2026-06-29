# Slice 5 — Dynamic Model Selection (design)

**Date:** 2026-06-29
**Status:** approved (brainstorm complete) → ready for implementation plan
**Depends on:** Slice 4 (Model Manager — live free-RAM budget, dynamic context sizing)
**Feeds:** Slice 6 (model discovery), parallel fan-out, the global scheduler (all in Future Work)

---

## 1. Problem & goal

Today an agent's model is **hardcoded at construction**: each factory bakes a
concrete `ModelDeclaration` (`file_qa`/`web_fetch` → `qwen3.5:9b`, orchestrator →
`qwen3.5:4b`) and builds a fixed `LanguageModel`. `Agent.modelDecl` is just that
frozen choice. Model choice is therefore a **code edit**.

Slice 5 turns model choice into a **runtime, capability-driven decision**: an
agent declares a *requirement* (`requires: [tools], prefer: largest-that-fits`),
and a **registry + selector** picks the best model that fits the **live** memory
budget at the moment of delegation; the Model Manager loads it. This is the
hardware-aware path — model selection becomes a function of live free RAM, not a
constant.

### Locked decisions (from brainstorming)

1. **Selection timing — live, per-delegation.** The selector runs inside
   `onBeforeDelegate` every delegation, against the budget *right then*. The
   agent's `LanguageModel` is bound **lazily** to the chosen model.
2. **Rank policy — largest-that-fits.** Among models that satisfy the hard
   requirements and fit the live budget, pick the most parameters the budget can
   afford; degrades 9b→4b under memory pressure. Tie-break by smaller footprint.
3. **Registry — a machine-adaptive ladder; bootstrap content = verified
   `qwen3.5:4b` + `qwen3.5:9b`.** The registry is conceptually a *capability
   ladder* of N rungs, and the selector is N-rung-capable from day one. We ship
   only the two rungs this 18GB laptop **live-runs and has verified**; we do not
   commit model tags we cannot validate on this hardware (per the
   "validate before locking" principle). The selector's **hard fits-filter is
   keyed to the live budget**, so a bigger rung is automatically *inert where it
   does not fit and engaged where it does* — one ladder serves a weak laptop and a
   strong Mac Mini with no code branch. The static content is explicitly a
   **bootstrap that Slice 6 discovery replaces with a per-machine runtime fetch**
   (no hardcoded list is the north star). Specialists select; the
   orchestrator/router stays fixed and pinned (`qwen3.5:4b`) — a router must stay
   small/fast/resident, and selecting it dynamically fights pinning.
4. **No-fit handling — capture-and-check → distinct `{kind:'resource'}` result.**
   When *no* candidate fits (even the smallest, after evicting all non-pinned),
   surface a real resource failure with an honest message; never hallucinate.
   (This is the **S5-DEBT-1** fix.)
5. **In-scope smarts:** greedy largest-that-fits **+ warm-aware anti-churn bias**
   (prefer an already-resident capable model over reload) **+ a full selection
   notice** (size / context / footprint / installed-or-pulling / budget / fits),
   emitted only when the decision changes.

---

## 2. New & changed types

### 2.1 `src/core/types.ts` — additions

```ts
/** A capability a model can advertise and an agent can require. String enum (extensible). */
export enum Capability {
  Tools = 'tools',
  // future: Vision = 'vision', LongContext = 'long-context', Coding = 'coding'
}

/** How the selector ranks the candidates that survive the hard filter. */
export enum PreferPolicy {
  LargestThatFits = 'largest-that-fits',
  // future: SmallestThatFits, QualityRanked, GlobalSchedule
}

/** What an agent declares instead of a concrete model name. */
export type ModelRequirement = {
  /** Human description of the role (as decl.role is today). */
  role: string;
  /** HARD filter — every listed capability must be present. */
  requires: Capability[];
  /** SOFT rank over the survivors. */
  prefer: PreferPolicy;
  /** Desired context window (moves here from params.numCtx for requirement-driven agents). */
  numCtx?: number;
};
```

`ModelDeclaration` gains one field so a declaration advertises what it can do
(keeps the registry a plain `ModelDeclaration[]`):

```ts
export type ModelDeclaration = {
  // ...existing fields...
  /** Capabilities this model provides; used by the selector's hard filter. */
  capabilities: Capability[];
};
```

### 2.2 `src/core/agent-def.ts` — `Agent` gains an optional requirement

```ts
export type Agent = {
  // ...existing fields...
  /** Requirement-driven model selection. When present, onBeforeDelegate resolves it live. */
  modelReq?: ModelRequirement;
};
```

`agent.model` (a concrete `LanguageModel`) stays **required** — it is the
**default binding** so an agent is still runnable without the hook (e.g. in unit
tests and the hook-less live tests). To preserve current behavior it stays the
agent's existing model (`qwen3.5:9b`, the largest capable candidate); selection
only changes the model when `onBeforeDelegate` returns a `model` override.

### 2.3 `OrchestratorResult` — third arm

```ts
export type OrchestratorResult =
  | { kind: 'answer'; text: string }
  | { kind: 'gap'; missingCapability: string; message: string }
  | { kind: 'resource'; message: string }; // NEW — no model fits the live budget
```

---

## 3. Components

### 3.1 `src/models/registry.ts` (new) — the curated registry

```ts
export const REGISTRY: ModelDeclaration[] = [qwenRouter, qwenFast];
```

Both declarations gain `capabilities: [Capability.Tools]`. This is the
**bootstrap content** of a ladder that is meant to grow: the selector handles N
rungs, and the live-budget fits-filter makes any rung self-adapting per machine
(inert where it doesn't fit). Slice 6 discovery will **replace this static array
with a per-machine runtime fetch**; the selector is agnostic to where entries come
from, so that lands without selector changes. Adding a rung today (e.g. a 14b for
the Mac Mini) is a one-line declaration — deliberately deferred so we only ship
tags verified on this hardware.

### 3.2 `src/resource/selector.ts` (new) — selection logic

Two functions, deliberately split so the policy is **pure and unit-testable** and
the live/fit concern lives with the manager (single source of truth — no
duplicated budget math):

```ts
/** PURE. Hard-filter by requires, then rank by prefer. No I/O. */
export function selectCandidates(
  req: ModelRequirement,
  registry: ModelDeclaration[],
  loaded?: ReadonlySet<string>, // names currently resident — for warm-aware bias
): ModelDeclaration[];
```

- **Hard filter:** keep declarations whose `capabilities` ⊇ `req.requires`.
- **Rank (`PreferPolicy.LargestThatFits`):** sort by `approxParamsBillions` desc;
  tie-break by smaller estimated footprint.
- **Warm-aware bias (anti-churn):** if `loaded` is supplied, a candidate that is
  *already resident and still capable* is promoted ahead of an equal-or-larger
  non-resident one, to avoid a transient RAM dip causing downgrade-then-reload
  churn. (Concretely: among candidates within the same "fits" tier, prefer the
  resident one.) The bias only *reorders*; it never admits a model that fails the
  hard filter.

```ts
/** LIVE. Walk candidates best-first; first that the manager can ready wins. */
export async function resolveModel(
  req: ModelRequirement,
  registry: ModelDeclaration[],
  deps: {
    ensureReady: (d: ModelDeclaration, o?: EnsureOpts) => Promise<number>;
    listLoaded?: () => Promise<LoadedModel[]>; // resident-set probe (warm-aware bias)
  },
  opts?: EnsureOpts,            // e.g. { pinned: [routerModel] }
): Promise<{ decl: ModelDeclaration; numCtx: number }>;
```

- `ensureReady` is the manager's method. `listLoaded` is an **optional** resident-set
  probe supplied by the caller (ollama-control's `listLoadedModels`, or a thin
  manager passthrough) — used only for the warm-aware bias; selection still works
  without it.
- For each candidate in ranked order: `await manager.ensureReady(decl, opts)`.
  - **success** → return `{ decl, numCtx }` (the manager remains the fit authority
    against the real `/api/ps` resident sizes — this is why **S5-DEBT-2** stays
    closed without re-deriving budget here).
  - **`ResourceError`** → try the next candidate (the **fallback loop**).
- candidates exhausted → **throw `ResourceError`** (a genuine "nothing fits").

### 3.3 Lazy model binding — `BeforeDelegate` + `runDefinedAgent`

```ts
// src/core/delegate.ts
export type BeforeDelegate = (
  agent: Agent,
) => Promise<{ numCtx?: number; model?: LanguageModel; abort?: string } | void>;
```

```ts
// src/core/agent-def.ts
export function runDefinedAgent(
  agent: Agent,
  task: string,
  numCtx?: number,
  modelOverride?: LanguageModel, // NEW — uses modelOverride ?? agent.model
): ReturnType<typeof runAgent>;
```

`asDelegateTool.execute` flow:

```ts
const pre = onBeforeDelegate ? await onBeforeDelegate(agent) : undefined;
if (pre?.abort) return { error: pre.abort };           // soft-stop, agent NOT run
const { text } = await runDefinedAgent(agent, task, pre?.numCtx, pre?.model);
return { text };
```

### 3.4 Selection notice (transparency)

The CLI wiring emits a structured notice **when the decision changes** (first
delegation to an agent, or a model switch). It carries everything computable at
selection time:

```
▸ web_fetch → qwen3.5:9b
  9B · Q4 weights ≈5.4GB + KV ≈2.1GB @ 16k ctx = ≈7.5GB
  live budget ≈12.3GB free · fits · installed
```
- If **not installed**, it announces the blocking pull *before* it happens:
  `not installed — pulling qwen3.5:9b (~5.4GB)…` so a first-run download is never
  a silent hang.
- Numbers come from `footprint` helpers + the chosen `numCtx` + `liveBudgetBytes()`
  + `isModelInstalled`. The notice is a small struct the CLI prints; emitting it is
  the wiring layer's job (core stays decoupled, as with the existing
  "Using project-local models" notice).

---

## 4. Data flow (per delegation)

```
orchestrator decides to delegate to <specialist>
  → onBeforeDelegate(agent)                                  [wired in chat.ts]
       if !agent.modelReq: return {}                          (non-selecting agent)
       try:
         { decl, numCtx } = resolveModel(req, REGISTRY, manager, { pinned:[router] })
         maybe emit selection notice (if decision changed)
         return { model: createOllamaModel(decl), numCtx }
       catch ResourceError as e:
         capture.error = e
         return { abort: "Can't run this now — no model fits in available memory" }
  → asDelegateTool: abort? → soft-stop ; else run agent with chosen model @ numCtx
  → orchestrator loop ends
runOrchestrator(...) : if capture.error → { kind:'resource', message } (checked FIRST)
chat.ts : print result by kind ; kind:'resource' → stderr + non-zero exit
```

---

## 5. Error handling — capture-and-check (S5-DEBT-1)

The AI SDK wraps any throw from a tool `execute` into a soft tool-result, so a
`ResourceError` thrown deep in `onBeforeDelegate` can't propagate as a hard error
on its own. The **capture seam** closes this:

- `ResourceCapture = { error?: ResourceError }` is created in `chat.ts` and closed
  over by `onBeforeDelegate`.
- On a genuine no-fit, the hook **sets `capture.error`** and returns
  `{ abort }`. `asDelegateTool` returns a soft `{ error }` so the model loop stops
  cleanly — the agent never runs on a wrong model and the router can't hallucinate
  a substitute answer.
- `runOrchestrator(orchestrator, task, numCtx?, capture?)` checks `capture.error`
  **before** the answer/gap logic and returns `{ kind:'resource', message }`.
- Only genuine `ResourceError` uses this path; real agent/tool failures still flow
  through the existing soft-error handling unchanged.

**S5-DEBT-2** (budget from lower-bound estimate vs real size) is already resolved
upstream — `ensureReady` sizes against `liveBudgetBytes()` with real resident
`/api/ps` accounting. Slice 5 does not re-open it; the new multi-size selection
tests *exercise* it for the first time, and `resolveModel`'s fallback loop is the
safety net if an estimate is ever optimistic.

---

## 6. Affected files

**New**
- `src/models/registry.ts` — `REGISTRY`.
- `src/resource/selector.ts` — `selectCandidates` (pure) + `resolveModel` (loop).

**Changed**
- `src/core/types.ts` — `Capability`, `PreferPolicy`, `ModelRequirement`;
  `capabilities` on `ModelDeclaration`.
- `src/core/agent-def.ts` — `Agent.modelReq?`; `runDefinedAgent` model override.
- `src/core/delegate.ts` — `BeforeDelegate` return (`model?`, `abort?`); execute honors them.
- `src/core/orchestrator.ts` — `runOrchestrator` optional `capture`; `{kind:'resource'}`.
- `agents/file-qa.ts`, `agents/web-fetch.ts` — declare `modelReq`; default `model` = smallest capable candidate.
- `models/qwen-router.ts`, `models/qwen-fast.ts` — add `capabilities: [Capability.Tools]`.
- `src/cli/chat.ts` — selector-based `onBeforeDelegate` + capture + selection notice + resource exit.
- Docs: `README.md`, `docs/architecture.md`, `docs/ROADMAP.md` (mark Slice 5 shipped; record Future Work below).

---

## 7. Testing

**Unit (mock — no Ollama)**
- `selectCandidates`: capability hard-filter; largest-first ordering; footprint
  tie-break; warm-aware bias reorders toward the resident candidate.
- `resolveModel` fallback loop with a mock manager: largest fits → picks it;
  largest throws `ResourceError` → picks next; all throw → throws `ResourceError`.
- Capture-and-check: a no-fit sets `capture.error` → `runOrchestrator` returns
  `{kind:'resource'}` (priority over answer/gap).
- Delegate tool honors the `model` override and the `abort` soft-stop.
- Degrade-to-4b path: inject a tiny budget so the 9b can't fit and assert the
  selector resolves to 4b (deterministic without real RAM pressure).

**Live (auto-skip unless Ollama + both models present)**
- With plentiful RAM, a specialist resolves to `qwen3.5:9b` (assert chosen model).
- Existing `orchestrator.live` / `orchestrator-web.live` / `model-manager.live`
  stay green.

---

## 8. Future work (COMMITTED — must be carried into ROADMAP)

These came directly out of the brainstorm and are **required future deliverables**,
not optional ideas. Slice 5 deliberately leaves the seams (`PreferPolicy` enum,
pure selector, the registry) so each drops in without rework.

1. **Global / lookahead model scheduler.** Greedy largest-that-fits is *local*.
   A scheduler that co-plans models across *future* tasks (minimize load/evict
   churn, honor a whole task graph) requires a **task planner / DAG engine** to
   know future delegations — which the dynamic LLM routing loop does not expose
   today. Lands as a new `PreferPolicy.GlobalSchedule` once the planner exists.
2. **Parallel fan-out memory arbitration.** Model contention only arises when
   specialists run **concurrently**. When parallel fan-out lands, the manager must
   arbitrate co-resident models within the live budget (with an explicit
   `maxLoaded` cap), and the selector must account for siblings' footprints, not
   just resident+pinned.
3. **Interactive resource arbitration ("user takes calls").** Under contention,
   some decisions are the user's (run sequentially vs degrade one agent vs evict).
   This overlaps the **Reclaim slice (4.5)** "ask the user once" escalation. Slice
   5 stays fully autonomous (degrade silently, else hard-fail with `{kind:'resource'}`).
4. **Quality-ranked selection.** A `PreferPolicy.QualityRanked` using a per-model
   quality signal (e.g. BFCL tool-calling score) — depends on **Slice 6 discovery**
   supplying the signal.
5. **Richer registry + discovery.** More curated models (e.g. a ~14b tier, a
   coding model) and runtime **HF discovery / auto-pull** (Slice 6) — gives
   largest-that-fits a real ladder and exercises the estimate-vs-real fit path
   harder.
6. **Router participates in selection.** Defer; today the router is fixed+pinned.
   Revisit only if a router-tier choice ever becomes budget-sensitive.
7. **Fuller anti-churn / hysteresis policy.** Slice 5 ships a cheap warm-aware
   bias; a fuller policy (cooldowns, switch thresholds) is future once churn is
   measured under real workloads.

---

## 9. Out of scope for Slice 5

HF discovery / auto-pull (Slice 6), quality-ranked selection, additional registry
models, router-as-selected, parallel fan-out, the global scheduler, and
interactive arbitration — all listed above as committed future work.
