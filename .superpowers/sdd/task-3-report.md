# Task 3 report — Gen-fit selector

## Status: DONE

## Commit
- `5165630` — feat(media): gen-fit selector — largest-that-fits, env-pin, uncensored, consent-gated
- Branch: `slice-28-hardware-adaptive-gen`

## What was done
Followed the brief verbatim (TDD):
1. Wrote the failing test `tests/media/gen-select.test.ts` (5 cases: largest-fits, no-fit→undefined, env-pin authoritative, uncensored filtering, consent-gated pull with decline-then-fallback).
2. Confirmed it failed with "Cannot find module select.ts".
3. Wrote `src/media/generate/select.ts` verbatim from the brief:
   - `selectGenModel(kind, deps)` — env-pin authoritative (bypasses ranking/consent) → filter by kind + uncensored eligibility (`uncensoredEnabled` / `isUncensoredModel`) → rank fitting candidates largest-params-first via `weightsBytes` + `fitsBudget` against `liveBudgetBytes()` (or injected `budgetBytes` test seam) → walk best→worst: installed → pick, else `askConsent` → pick on yes else continue → no pickable candidate → `recordGenFit({fits:false})`, return `undefined`.
   - `SelectGenDeps` type (env, budgetBytes, isInstalled, askConsent, catalog — all optional, defaults to live env/GEN_CATALOG/liveBudgetBytes/HF-cache-check/decline).
   - `isGenModelInstalled(repo)` — checks `~/.cache/huggingface/hub/models--org--name` existence.
   - `defaultAskConsent` — declines by default (fail-safe, never speculative pull); matches the "consent before model pull" standing rule.
4. Verified all imports resolved cleanly against existing code: `GEN_CATALOG`/`GenModelCandidate`/`GenEngine` (`src/media/generate/catalog.ts`, Task 1), `weightsBytes` (`src/resource/footprint.ts`), `fitsBudget`/`liveBudgetBytes` (`src/resource/hardware.ts`), `uncensoredEnabled`/`isUncensoredModel` (`src/media/policy.ts`), `recordGenFit` (`src/telemetry/spans.ts`, Task 2, signature `{kind, chosen?, fits, budgetBytes, modelBytes?, candidates}`), `MediaKind`/`ExecMode` (`src/media/types.ts`), `MediaVenv` (`src/media/cmd-resolve.ts`), `ContentPolicy` (`src/core/types.ts`).
5. Test run: 5 pass / 0 fail / 5 expect() calls.
6. `bun run lint:file --write` auto-fixed import ordering (type-only imports grouped/sorted, alphabetized) in both files — no logic changes. Re-ran tests after the auto-fix: still 5 pass.
7. `bun run typecheck` — clean (`tsc --noEmit`, no output/errors).
8. Committed both files. Pre-commit hook ran `docs-check` — passed (no new `src/<subsystem>` directory was introduced; `src/media/generate/` already documented from Task 1).

## Notes / no scope added
- No deviation from the brief's prescribed code — used verbatim except for the biome-imposed import reordering (mechanical, non-semantic).
- No new architecture-doc changes needed for this task specifically (Task 1 already covers `src/media/generate/`); the slice-level architecture.md update is presumably handled at slice close per the SDD ledger process, not per-task.

## Blocking concerns
None.

## Fix commit (review follow-up)

### Status: DONE

Three review findings applied on top of `5165630`:

1. **[Important] Real enum members, not string casts** — the env-pin fallback
   synthetic candidate (`src/media/generate/select.ts`, ~lines 60–72) used
   `'mflux' as GenModelCandidate['engine']`, `'Media' as ...['venv']`,
   `'OneShot' as ...['execMode']` — casts that hid a runtime-value mismatch
   (`MediaVenv.Media === 'media'`, `ExecMode.OneShot === 'one_shot'`), which
   would have misrouted `adapter.ts`'s `primary.execMode === ExecMode.OneShot`
   check. Replaced with the real enum members: imported `GenEngine` from
   `./catalog.ts`, `MediaVenv` from `../cmd-resolve.ts`, `ExecMode` from
   `../types.ts`, and used `GenEngine.Mflux`, `MediaVenv.Media`,
   `ExecMode.OneShot` directly as fallback defaults.

2. **[Minor] Honor `HF_HOME` in `isGenModelInstalled`** — it hardcoded
   `~/.cache/huggingface/hub/...`. Matched the env-override convention from
   `src/provisioning/dest-dir.ts` (`HF_HOME` first, fallback-only). Added an
   optional injectable `env` parameter (defaults to `process.env`, matching
   the `SelectGenDeps.env` pattern already in the file); when `HF_HOME` is
   set, looks under `$HF_HOME/hub/models--org--name`, else falls back to
   `~/.cache/huggingface/hub/models--org--name`. Stays pure/never-throw
   (`existsSync` doesn't throw). Wired the default `isInstalled` walker to
   pass the resolved `env` through.

3. **[Minor] Test the consent-GRANTED pick path** — added
   `tests/media/gen-select.test.ts` test `'consent-gates a pull: granting
   picks the not-installed candidate that fits'`: a single not-installed,
   fitting candidate with `askConsent: async () => true` asserts
   `selectGenModel` returns that candidate. Previously only the decline path
   was covered.

Covering test file: `tests/media/gen-select.test.ts` (now 6 tests: the
original 5 + the new consent-grant case).

Command run: `bun run test:file -- "tests/media/gen-select.test.ts"`
Output:
```
bun test tests/media/gen-select.test.ts
bun test v1.3.11 (af24e281)

 6 pass
 0 fail
 6 expect() calls
Ran 6 tests across 1 file. [98.00ms]
```

Lint: `bun run lint:file --write -- "src/media/generate/select.ts" "tests/media/gen-select.test.ts"` → `Checked 2 files in 7ms. No fixes applied.`
Typecheck: `bun run typecheck` → `tsc --noEmit` clean, no errors.

Fix commit: see `git log` on branch `slice-28-hardware-adaptive-gen`,
message `fix(media): gen-fit selector — real enum fallbacks, HF_HOME cache, consent-grant test`.

### Blocking concerns
None.
