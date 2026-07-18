# Task 16 Report: `GET /api/models` inventory handler

(Note: this overwrites a stale `task-16-report.md` from an earlier
task-numbering pass — an unrelated `RunsArea` web-list report from Phase 3
— per this repo's numbering-reuse convention.)

## Summary

Implemented the read-side model inventory for the BFF, exactly per the brief (verbatim code/tests, no deviations):

- `src/server/models/discover.ts` — `discoverModels(deps?)`: composes `buildRegistry()` (installed, offline-safe) with `fitAndRank(readCatalog(), detectHost().liveBudgetBytes)` (pullable, ranked against the cached catalog — no live network re-discovery per request, per the brief's design note).
- `src/server/models/list.ts` — `handleModelList(deps)`: thin BFF adapter. Builds installed rows (`fits: true` always), dedupes pullable rows against the installed set by `runtime::model`, computes each pullable row's `sizeBytes` (preferring `fileSizeBytes`, falling back to `estimatedBytes`) and a disk-shortfall via `checkDiskSpace()` against live free space, then validates/serializes the merged list through `ModelListResponseSchema.parse(...)` and returns a 200 JSON `Response` with `ISOLATION_HEADERS` (matching the crews/workflows/runs GET-handler idiom exactly — same `json()` helper shape as `src/server/crews/list.ts`).

No `app.ts` route wiring in this task — confirmed via `task-17-brief.md` that `GET /api/models` + `POST /api/models/pull` are wired together in Task 17 (`ServerDeps.runModelPull` needs to exist first). Task 16's file list (discover.ts, list.ts, two test files) is exhaustive as written.

## TDD evidence

**RED** (`bun test tests/server/models-discover.test.ts tests/server/models-list.test.ts`):
```
error: Cannot find module '../../src/server/models/discover.ts' ...
error: Cannot find module '../../src/server/models/list.ts' ...
0 pass / 2 fail / 2 errors
```

**GREEN** (after implementing both files):
```
2 pass
0 fail
6 expect() calls
Ran 2 tests across 2 files.
```

## Gate (all three, before commit)

- `bun run typecheck` — clean (`tsc --noEmit`, no output).
- `bun run lint:file -- src/server/models/discover.ts src/server/models/list.ts tests/server/models-discover.test.ts tests/server/models-list.test.ts` — 0 errors after one `bunx biome check --write` pass to fix import-sort + object-literal formatting on the two new test files (content unchanged, only formatting).
- Focused tests — 2 pass / 0 fail (above).

## Files changed

- `src/server/models/discover.ts` (new)
- `src/server/models/list.ts` (new)
- `tests/server/models-discover.test.ts` (new)
- `tests/server/models-list.test.ts` (new)

## Commit

`f2bfaca` — `feat(server): GET /api/models — installed + pullable inventory (Phase 5)`
(4 files changed, 181 insertions; only these 4 files staged/committed — other pre-existing unstaged repo changes from earlier tasks were left untouched.)

## Self-review

- Verified interface types line up exactly with prior-task contracts: `ModelDeclaration`/`ProviderKind`/`RuntimeKind` (`src/core/types.ts`), `Candidate`/`HostCapabilities` (`src/discovery/catalog-source.ts`), `FitCandidate`/`fitAndRank` (`src/provisioning/fit.ts`), `checkDiskSpace`/`PreflightInput` (`src/provisioning/supervisor.ts`), `ModelListResponseSchema`/`ModelInventoryDtoSchema` (contracts T5/T6) — no shape mismatches, no `any`.
- `handleModelList`'s dependency-injection shape (`{ freeDiskBytes, discovery? }`) matches the sibling GET handlers' testability pattern (deps object, real implementations as defaults inside `discoverModels`).
- No `provider` field leaks onto the wire for pullable rows (per Task 5's design note, called out in the handler's doc comment) — `ModelInventoryDtoSchema` doesn't have that field so `.parse()` strips it; the mapped literal never includes it either.
- Read-only, no side effects: `discoverModels` never touches `CatalogSource.listCandidates()` (live network) — only the cached `readCatalog()` — matching the "no live re-discovery per request" design note.

## Concerns

None blocking. Two minor forward-notes, both expected/by-design:
1. Route is not yet reachable at `/api/models` — that's Task 17's job (route wiring + `ServerDeps.runModelPull`), confirmed by reading `task-17-brief.md` before finishing.
2. Did not run the full repo test suite (per `feedback-sdd-implementer-inline-tests.md`, that's the controller's job between tasks) — only the two focused new test files, both green.

## Follow-up fix (post-review)

**Finding addressed (Important — coverage gap on real branches):** the original
two tests only exercised one installed row + one fitting pullable row, leaving
two real code branches unexercised: (1) empty inventory, (2) a
degraded/undefined discovery source.

**What was added** (test-only, no production code changed):

- `tests/server/models-discover.test.ts` — 3 new tests:
  1. Empty inventory: `buildRegistry` → `[]`, `readCatalog` → `[]` — asserts
     `discoverModels` returns `{ installed: [], pullable: [] }`, no throw.
  2. Undefined catalog (cache miss): `readCatalog: () => undefined` — asserts
     `discoverModels` degrades gracefully to `pullable: []` via the real
     `catalog ?? []` guard in `discover.ts:27` (genuine code path, not
     invented).
  3. Throwing `buildRegistry`: asserts the rejection **propagates** —
     `discoverModels` does NOT catch it.
- `tests/server/models-list.test.ts` — 3 matching tests at the handler layer:
  empty-inventory → valid empty `ModelListResponse` (`items: []`, schema
  parses); undefined-catalog → degrades to installed-only rows; throwing
  `buildRegistry` → `handleModelList` also propagates (no try/catch wraps
  `discoverModels` in `list.ts:28` either).

**Degrade semantics — ACTUAL observed behavior (not invented):**
- The `catalog ?? []` guard in `discover.ts` **is** genuine graceful
  degradation for an undefined/cache-miss catalog — confirmed by test and by
  reading the code (`discover.ts:27`).
- A **throwing `buildRegistry` dep propagates** — `discover.ts` has no
  try/catch around `await (deps.buildRegistry ?? realBuildRegistry)()`, and
  `list.ts` has no try/catch around its call to `discoverModels`. The
  per-runtime try/catch the finding refers to lives *inside* the real
  `buildRegistry` implementation (`src/discovery/build-registry.ts`:
  `installedFromRuntimes` and `filterInstalledCatalog` each catch internally
  so the real default `buildRegistry` itself never throws for a down
  runtime) — it is not, and was never meant to be, duplicated in
  `discoverModels`/`handleModelList`. Since this matches the original design
  intent (offline-safety lives in `buildRegistry`, not in its callers) and
  isn't a spec mismatch, no production code was changed — only test
  assertions documenting the real propagate behavior for an injected
  throwing dep.

**Fix commit:** `dc913d7` — `test(server): cover empty-inventory +
degraded-source paths for GET /api/models (Phase 5 T16 review)` (2 files
changed, 104 insertions, test-only).

**Test evidence:**

```
$ bun test tests/server/models-discover.test.ts tests/server/models-list.test.ts
bun test v1.3.11 (af24e281)

 8 pass
 0 fail
 17 expect() calls
Ran 8 tests across 2 files. [185.00ms]
```

**Gate:** `bun run typecheck` — clean (`tsc --noEmit`, no output). `bun run
lint:file -- tests/server/models-discover.test.ts
tests/server/models-list.test.ts` — `Checked 2 files in 3ms. No fixes
applied.` (0 errors).
