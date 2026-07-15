# Task 2 report — RunListItemDTO — list-cheap run summary DTO

## Status: DONE — GREEN, committed

## TDD Cycle

**RED** — Added two failing tests to `tests/contracts/dto.test.ts`:
1. `RunListItemDTO parses a minimal summary (tokens optional, no spans/artifacts)` — verifies parsing without optional fields and confirms no `spans`/`artifacts` properties exist
2. `RunListItemDTO round-trips with a token roll-up present` — confirms optional token object round-trips correctly

Ran focused test:
```
bun test tests/contracts/dto.test.ts
```
Failed as expected: `RunListItemDtoSchema` not yet exported (import error in test file).

**Implementation** — Exactly per brief (`/.superpowers/sdd/task-2-brief.md`):
- `src/contracts/dto.ts`: Appended `RunListItemDtoSchema` and `RunListItemDTO` type alias after `RunDtoSchema`. Schema defines 9 required fields (`id`, `startMs`, `durationMs`, `outcome`, `lifecycle`, `origin`, `models`, `degraded`, `spanCount`) and 1 optional field (`tokens`), reusing the module-local `TokensSchema` already declared at file top. No `spans`, `artifacts`, or `degrades` fields (the core optimization for list cache). Used `.enum(RunLifecycle)` and `.enum(RunOrigin)` to reference the existing enums from `enums.ts`.
- `tests/contracts/dto.test.ts`: Imported `RunListItemDtoSchema` from dto, appended the two test cases verbatim.
- `src/contracts/index.ts`: No changes needed — barrel already exports `* from './dto.ts'`.

**GREEN**:
```
bun test tests/contracts/dto.test.ts
 10 pass / 0 fail / 19 expect() calls
```
All 10 tests pass (8 pre-existing + 2 new for RunListItemDTO).

## Gate

- `bun run typecheck` → clean (no output from `tsc --noEmit`).
- `bun run lint:file -- "src/contracts/dto.ts" "tests/contracts/dto.test.ts"` → `Checked 2 files in 3ms. No fixes applied.`
- Pre-commit hook ran automatically on `git commit` → `✔ docs-check: living docs present + linked; every src subsystem documented.`

## Commit

```
db4425a feat(contracts): RunListItemDTO — list-cheap run summary (no spans/artifacts)
```

Commit message body:
```
Add RunListItemDtoSchema and RunListItemDTO type to provide a lightweight
summary projection for run history lists. The DTO excludes spans, artifacts,
and degrades to optimize for list performance. Includes minimal fields: id,
timing, outcome, lifecycle, origin, models, degradation flag, and optional
token roll-up. Tested with minimal and full-tokens variants.
```

## Files Changed
- `src/contracts/dto.ts` — added `RunListItemDtoSchema` (z.object) + `RunListItemDTO` type infer (45 lines total, 16 new).
- `tests/contracts/dto.test.ts` — imported `RunListItemDtoSchema`, appended 2 new test cases (35 new lines).

## Self-Review
- **Schema completeness**: All 9 fields match the brief exactly. `RunLifecycle` and `RunOrigin` enum references use `.enum(...)` matching the existing `RunDtoSchema` pattern (not hardcoded strings).
- **Optional field handling**: `tokens: TokensSchema` correctly makes tokens optional since `TokensSchema` is already `.optional()` at declaration.
- **No heavy arrays**: Confirmed test assertions that `'spans' in parsed` and `'artifacts' in parsed` both return false — the schema has no such properties.
- **Export barrel**: No changes needed; auto-exported via existing `export * from './dto.ts'` in `src/contracts/index.ts`.
- **Forward-compat**: Tests verify both the absent-tokens case and the present-tokens case, matching the forward-compat pattern used in `SpanDtoSchema` and `RunDtoSchema`.
- **Code style consistency**: Schema uses same formatting, optional placement, and enum reference pattern as existing `RunDtoSchema` in the same file. Type alias follows the same `type X = z.infer<typeof XSchema>` pattern.

## Concerns
None. Scope was straightforward; implementation follows the brief exactly (schema + tests + export). No ambiguity; no deviations from the specified code.
