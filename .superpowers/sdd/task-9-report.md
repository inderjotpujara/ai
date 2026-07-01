# Task 9 Report: Manual Spans at Delegation / Model-Select / Model-Load·Evict + Live E2E

## Status: IMPLEMENTED

---

## TDD RED -> GREEN Evidence

**Step 1 — RED:** Added the delegation span test to `tests/core/delegate.test.ts`. Running `bun test tests/core/delegate.test.ts` yielded:

```
error: expect(received).toBeDefined()
Received: undefined
(fail) asDelegateTool opens an agent.delegation span tagged with the target
5 pass / 1 fail
```

Confirmed failing because `withDelegationSpan` was not yet called in `delegate.ts`.

**Step 2 — GREEN:** Added `withDelegationSpan(agent.name, async () => { ...existing try/catch... })` wrapper to `asDelegateTool`'s `execute`. Running the same test:

```
6 pass / 0 fail
```

---

## Files Changed

### Modified
1. **`src/core/delegate.ts`** — Added `import { withDelegationSpan } from '../telemetry/spans.ts'` and wrapped the `execute` body in `withDelegationSpan(agent.name, ...)`, preserving the exact try/catch and return shapes.

2. **`src/cli/select-hook.ts`** — Added `import { recordModelSelect } from '../telemetry/spans.ts'` and called `recordModelSelect({ modelId, provider, numCtx, paramsBillions })` immediately after `resolveModel` returns `{ decl, numCtx }`, before `deps.notify`.

3. **`src/resource/model-manager.ts`** — Added `import { recordEvict, withModelLoadSpan } from '../telemetry/spans.ts'` (note: `activeKvCacheType` was already imported). Added `recordEvict(evict.name, evict.sizeBytes, evictReason)` before `c.unload()` in the eviction loop. Replaced `await c.warm(target, chosenCtx)` with `await withModelLoadSpan(target, { weightsBytes: weights, kvF16PerToken: f16Base, kvEffectivePerToken: kvPerToken, kvCacheType: activeKvCacheType(), chosenCtx, requestedCtx: desired, footprintBytes: weights + kvCacheBytes(chosenCtx, kvPerToken), budgetBytes: freeBudget }, () => c.warm(target, chosenCtx))`.

   Variable name verification (confirmed from actual file before editing):
   - `weights` — `weightsBytes(...)` result at line 123
   - `f16Base` — from `kvF16For(...)` at line 127
   - `kvPerToken` — `effectiveKvBytesPerToken(f16Base)` at line 128
   - `chosenCtx` — computed at line 166-169
   - `desired` — `decl.params.numCtx ?? MIN_CTX` at line 113
   - `freeBudget` — `resolveBudget(d.budgetBytes)` at line 130
   - `evict.sizeBytes` — field on `LoadedModel`
   - `pinned` — `new Set(opts.pinned ?? [])` at line 111
   - `kvCacheBytes` — already imported from `./footprint.ts`

### Added
4. **`tests/core/delegate.test.ts`** — Added delegation span test using `registerTestProvider()` from `tests/helpers/otel-test-provider.ts`, `beforeEach`/`afterEach` for provider lifecycle, and assertion that `asDelegateTool(agent).execute(...)` produces an `agent.delegation` span tagged `agent.delegation.target === 'web_fetch'`.

5. **`tests/integration/run-viewer.live.test.ts`** — Created live e2e test mirroring `orchestrator.live.test.ts` pattern: `ollamaReady(qwenRouter.model)` gate, `describe.skipIf(!ready)`, `afterAll(unloadModel)`, 120_000 timeout. Runs `runChat({ orchestrator, task, runsRoot, runId: 'live-1' })` against a real file, then asserts `spans.jsonl` contains `agent.run`, `agent.delegation`, and `ai.generateText` spans, and `renderRun` output contains `'agent.run'`.

---

## Full Suite Result

```
bun run typecheck   — pass (no errors)
bun run lint        — pass (1 deprecation info in biome.json — pre-existing, not introduced by this task)
bun test            — 165 pass, 14 skip, 0 fail (179 tests across 59 files)
```

---

## Live Test Status

**SKIPPED** — Ollama was not running at commit time (`curl localhost:11434/api/version` timed out). The test auto-skipped via `describe.skipIf(!ready)` as designed.

---

## Self-Review

**Spec coverage for this task:**
- delegation span fires from `asDelegateTool.execute` via `withDelegationSpan`
- model-select event fires from `createSelectHook` after `resolveModel` succeeds
- model-load span wraps `c.warm()` in `ensureReady` via `withModelLoadSpan`
- evict event fires before `c.unload()` with correct `lru-fit` / `budget-too-low-evicting-pinned` reason
- live test cleanly skips when Ollama down; ready to run when Ollama is up

**Correctness checks:**
- The `execute` return shape is unchanged: `{ text }` on success, `{ error }` on abort/throw
- `recordEvict` and `recordModelSelect` are best-effort (no active span = no-op, safe per spec §1.6)
- Import order fixed to satisfy Biome's `organizeImports` rule

**Concerns:** None. All three seams are wired, the delegation test is RED->GREEN TDD, and the full suite is green.
