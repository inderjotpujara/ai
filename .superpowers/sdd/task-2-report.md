# Task 2 Report: Reroute the download registry + wire LM Studio (Slice 18)

> Note: this file previously held the Slice 17 Task 2 report. That work is
> preserved in git history. This file now holds the Slice 18 Task 2 report.

## Status

**COMPLETED**

## Summary
Rewrote `providerFor` in `src/provisioning/registry.ts` to route all four
`ProviderKind` download kinds (`Ollama`, `HfGguf`, `HfSnapshot`, `LmStudio`),
wiring in the previously dead `createLmStudioProvider`. Updated
`catalogSourcesFor` to source the HF catalog with `ProviderKind.HfSnapshot`
instead of the now-removed `ProviderKind.MlxServer`. Fixed
`src/provisioning/providers/lmstudio.ts:27` to report `kind: ProviderKind.LmStudio`
(was `ProviderKind.MlxServer`, dropped the now-inaccurate shared-kind comment).
`enrichSize` was left untouched per the brief — its non-Ollama branch already
sums the HF tree generically and works for both HF kinds.
`src/provisioning/providers/hf-fetch.ts` required no change — it already
accepted a generic `kind: ProviderKind` parameter and passes it through.

## TDD sequence
1. Wrote `tests/provisioning/registry.test.ts` (3 tests, per brief, exact text).
2. Ran `bun run test:file -- "tests/provisioning/registry.test.ts"` — confirmed
   RED: 2 of 3 tests failed. `providerFor(ProviderKind.HfGguf)` and
   `providerFor(ProviderKind.LmStudio)` both returned the Ollama provider
   (kind `"Ollama"`) instead of the expected kind, because the old switch only
   matched `ProviderKind.Ollama` and the removed `ProviderKind.MlxServer`
   (now `undefined` at runtime, since Task 1 deleted it from the enum) —
   so both new kinds fell through to the `default` branch.
3. Implemented the changes described above.
4. Re-ran the same test command — GREEN: 3 pass / 0 fail / 4 expect() calls.
5. Committed.

## Files changed
- `src/provisioning/registry.ts` — `providerFor` switch now handles
  `HfGguf`/`HfSnapshot` (→ `createHfFetchProvider`), `LmStudio` (→
  `createLmStudioProvider`, newly imported), `Ollama` (unchanged), default
  falls back to Ollama (unchanged behavior). `catalogSourcesFor` now calls
  `createHfCatalogSource(ProviderKind.HfSnapshot)`.
- `src/provisioning/providers/lmstudio.ts` — `kind` field corrected to
  `ProviderKind.LmStudio`.
- `tests/provisioning/registry.test.ts` — new, 3 tests per brief.

## Verification
```
$ bun run test:file -- "tests/provisioning/registry.test.ts"
 3 pass
 0 fail
 4 expect() calls
Ran 3 tests across 1 file.
```
Only this scoped test was run, per instructions. Full `bun run typecheck` /
`bun test` were intentionally NOT run — `src/runtime/*`, `src/discovery/*`,
and `src/provisioning/catalog/hf-catalog.ts` still reference the removed
`ProviderKind.MlxServer` and remain red pending Tasks 3-4. This is expected
residual breakage, not something introduced by this task.

## Commit
`f4954b2` — `feat(provisioning): route HfGguf/HfSnapshot/LmStudio download kinds + wire dead LM Studio provider`
(3 files changed, 32 insertions, 5 deletions) on branch `slice-18-debt-wrapup-mlx`.
The pre-commit `docs:check` hook ran and passed (no `docs/architecture.md`
changes needed for this task — no new subsystem).

## Concerns
None. Implementation matches the brief's exact code verbatim (registry.ts
switch, lmstudio.ts kind fix). No ambiguity encountered; no scope creep into
Task 3/4 files (`src/runtime/*`, `src/discovery/*`, `hf-catalog.ts` untouched).
