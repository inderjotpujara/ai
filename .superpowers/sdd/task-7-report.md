# Task 7 Report: Serialize model-manager admission (eviction lock)

## Status: DONE

## Commit
`4008f09` — fix(resource): serialize model-manager admission (concurrent ensureReady raced eviction/VRAM budget)

## What changed
- `src/resource/model-manager.ts`:
  - Added a per-manager promise-chain mutex (`admissionLock` + `serialize()`) near the per-instance state maps (~line 70), with a comment explaining the `.then(fn, fn)` + `.catch(() => {})` swallow pattern (one failed admission doesn't wedge the chain for subsequent callers).
  - Renamed the existing `ensureReady` body to `ensureReadyInner` (logic unchanged).
  - Added a thin `ensureReady(decl, opts = {})` wrapper that returns `serialize(() => ensureReadyInner(decl, opts))`.
  - Public API (`return { ensureReady, unloadAll };`) unchanged.
- `tests/resource/model-manager-lock.test.ts` (new): concurrency test asserting `warm` never overlaps (`maxActive === 1`) when two `ensureReady` calls race. Deviated from the brief's verbatim snippet only where needed to satisfy strict typecheck/lint:
  - `runtime: 'ollama'` (string literal) → `runtime: RuntimeKind.Ollama` (this repo's convention is enum over string-literal unions for finite named sets, and `RuntimeKind` is not a string-literal-comparable type), which let the `as ModelDeclaration` cast be dropped since the object now structurally matches `ModelDeclaration`.
  - Import order adjusted (type import from `core/types.ts` before the value import from `resource/model-manager.ts`) to satisfy biome's `organizeImports`.

## TDD flow
1. Wrote the test first; ran `bun test tests/resource/model-manager-lock.test.ts` — failed as expected: `Expected: 1, Received: 2` (both `warm` calls overlapped, proving no serialization existed before the fix).
2. Implemented the mutex + rename + wrapper exactly as specified in the brief.
3. Re-ran — test passes (`maxActive === 1`).

## Verification
- `bun test tests/resource/` → **78 pass, 0 fail** across 15 files (includes the pre-existing 25 model-manager tests in `model-manager.test.ts`, the `model-manager-kv.test.ts` suite, and the new lock test — all green, no regressions).
- `bun run typecheck` → clean, no errors.
- `bun run lint:file -- "src/resource/model-manager.ts" "tests/resource/model-manager-lock.test.ts"` → clean, no errors/warnings.
- No stray `console.log` introduced.
- `bun run docs:check` (pre-commit hook) passed — this is an internal-mechanism change inside an already-documented subsystem (`src/resource`); no new subsystem/doc surface was introduced by this task alone.

## Self-review (per dispatch instructions)
- **Mutex genuinely serializes**: confirmed empirically — the test failed at `maxActive === 2` before the fix, and passes at `maxActive === 1` after.
- **No deadlock on a rejected `ensureReadyInner`**: `.then(fn, fn)` chains onto the prior link whether it resolved or rejected, and `admissionLock = run.catch(() => {})` swallows the rejection only on the *stored* chain link — the caller's own returned `run` promise still rejects normally, so real errors are still surfaced to callers. This is also empirically validated: the pre-existing test `'per-run failed-pull guard: a model whose pull already failed is not re-pulled — throws ProviderError immediately'` (in `tests/resource/model-manager.test.ts`) issues two *sequential* `ensureReady` calls where the first rejects (simulated pull failure) and the second must still execute (and itself reject via the `failedPulls` guard, not hang). That test is part of the 78 passing, confirming the lock unwedges after a rejection rather than deadlocking subsequent callers.
- **All 25 existing model-manager tests pass**: confirmed via the full `bun test tests/resource/` run above (78 total across 15 files, 0 fail).

## Concerns
None. The change is minimal and additive, matching the brief's mutex code verbatim. The only deviations from the brief's literal test snippet were required to satisfy this repo's stricter TypeScript/enum conventions (`RuntimeKind.Ollama` instead of a raw string literal) and biome's import ordering — both cosmetic, with no change to the test's intent or assertions.
