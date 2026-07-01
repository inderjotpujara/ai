# Task 10 Report: Discovery Pipeline + Offline-Safe Registry Builder

## Status: COMPLETE

## Commit
`d4ef079` — feat(discovery): discover pipeline + offline-safe registry builder

## Test Summary
14 pass, 0 fail across 7 files (includes all pre-existing discovery tests + 3 new tests in build-registry.test.ts and discover.test.ts). Typecheck clean.

## Files Created
- `src/discovery/sources.ts` — SOURCES array re-exporting hfGgufSource + hfMlxSource
- `src/discovery/build-registry.ts` — offline-safe merge; installed/catalog failures degrade gracefully
- `src/discovery/discover.ts` — full pipeline: gather → dedupe by (provider,repo) keeping highest downloads → rank (downloads desc, params desc) → writeCatalog → pre-pull top-N

## Self-Review: Offline Safety Verification
- **Failing source**: `runDiscovery` wraps each `s.listCandidates()` in `try/catch`; a failure contributes nothing to `all[]` — pipeline continues.
- **Failing installed probe**: `buildRegistry` wraps the `installed()` call in `try/catch`; falls back to `[]` — bootstrap still returned.
- **Missing catalog**: `readCatalog()` returns `undefined`; the `?? []` coalesces to empty — no throw.
- **Failing pull**: `pull()` is wrapped in `try/catch`; failed pulls don't appear in `pulled[]` but don't throw out of `runDiscovery`.

## Concerns
None. The import alias (`REGISTRY` → will be `BOOTSTRAP` in Task 11) is documented inline per the brief's instruction. The `Capability` import alias (`Cap`) avoids the name collision with the local `Capability` type import; this pattern is consistent with the brief's provided code.
