# Task 1: Contracts wire enums + isomorphic-purity guard test — Report

## Status: DONE

## Commit
`6bc8abd` — feat(contracts): add wire enums + isomorphic-purity guard test

## What was implemented

Created the foundational `src/contracts/` subsystem (Slice 30b, Phase 1) — an isomorphic Zod-based wire protocol layer that will support the first web UI.

**Files created:**
- `src/contracts/enums.ts` — 8 string enums (`RunOrigin`, `RunLifecycle`, `SpanStatus`, `ArtifactKind`, `DegradeKind`, `ChatRole`, `ModelLoadAction`, `StatusEventType`) with 0 imports (isomorphic-pure).
- `tests/contracts/enums.test.ts` — 4 enum validation tests (RunOrigin values, RunLifecycle non-terminal states, DegradeKind mirror values, StatusEventType discriminants).
- `tests/contracts/isomorphic.test.ts` — 1 filesystem-scan guard test enforcing the isomorphic rule: `src/contracts/**/*.ts` files may import **only** `zod` or sibling `./` files, never `node:*`, `../`, or AI SDK.

**Files updated:**
- `docs/architecture.md` — added `src/contracts/` subsystem row to the layer table (after Core, before DB migrations).

## TDD steps

1. **RED:** Wrote `tests/contracts/enums.test.ts` (4 tests from the brief); ran `bun test tests/contracts/enums.test.ts` → failed with `Cannot find module '../../src/contracts/enums.ts'`.
2. **GREEN:** Wrote `src/contracts/enums.ts` (8 enums from the brief, verbatim); ran `bun test tests/contracts/enums.test.ts` → 4 pass, 0 fail.
3. **GREEN:** Wrote `tests/contracts/isomorphic.test.ts` (1 guard-scan test from the brief); ran `bun test tests/contracts/isomorphic.test.ts` → 1 pass, 0 fail.
4. **GREEN:** Updated `docs/architecture.md` (added Contracts subsystem row); ran `bun run docs:check` → green.
5. **Committed:** `git commit -m "feat(contracts): add wire enums + isomorphic-purity guard test"`.

## Test results

```
$ bun test tests/contracts/enums.test.ts tests/contracts/isomorphic.test.ts
bun test v1.3.11 (af24e281)
 5 pass
 0 fail
 7 expect() calls
Ran 5 tests across 2 files. [30.00ms]
```

## Self-review

✅ **Enum definitions are correct:**
- All 8 enums match the brief's specifications exactly (enum names, values, counts).
- Values follow the wire-protocol naming (kebab-case for discriminants like `data-run-start`, snake_case for degradation kinds).
- `DegradeKind` deliberately mirrors `src/reliability/ledger.ts` values without importing it (isomorphic rule preserved).

✅ **Isomorphic purity is enforced:**
- `enums.ts` has zero imports — it's pure (TypeScript-only, no dependencies).
- The guard test scans all `.ts` files in `src/contracts/`, verifying imports against the allowlist (`zod` + `./`).
- Test correctly uses `node:fs` and `node:path` (allowed in tests, disallowed in `src/contracts/`).
- Regex correctly extracts all `import ... from '...'` and `export ... from '...'` specifiers.

✅ **Documentation updated:**
- Added row to `docs/architecture.md` layer table with full description of the contracts subsystem, the isomorphic rule, and what it's used for (Tasks 2–4).
- The `docs-check` pre-commit hook passed after the update.

✅ **Committed correctly:**
- Commit message follows conventional-commit format: `feat(contracts): ...`
- Commit includes all 4 files (enums.ts, both tests, architecture.md).
- Pre-commit hooks validated (docs-check passed).

## Concerns

None. The task was pure transcription from the brief. All code, enums, test assertions, and file locations matched the brief exactly. No ambiguity arose; the brief's code and values were the requirements.
