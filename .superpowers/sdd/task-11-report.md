# Task 11 Report: discover CLI + chat wiring + REGISTRY→BOOTSTRAP rename

**Status:** COMPLETE

**Commit hash:** a11e7e3

**Test summary:** 119 pass / 10 skip / 0 fail (129 tests across 46 files, 3.11s)

## What Was Done

1. `models/registry.ts`: renamed `REGISTRY` → `BOOTSTRAP` (array contents and doc comment unchanged).
2. `src/discovery/build-registry.ts`: updated import and usage of `REGISTRY` → `BOOTSTRAP`.
3. `src/cli/chat.ts`: removed `import { REGISTRY }`, added `import { buildRegistry }`, added `const registry = await buildRegistry();` just before `createSelectHook`, passed `registry` instead of `registry: REGISTRY`. Router warm+pin and `manager.unloadAll()` in `finally` are intact.
4. `src/cli/discover.ts`: created per brief — calls `runDiscovery()`, prints summary to `console.error`, sets `process.exitCode = 1` on failure.
5. `package.json`: added `"discover": "bun run src/cli/discover.ts"` to scripts.
6. Test files updated (all `REGISTRY` → `BOOTSTRAP`): `tests/models/registry.test.ts`, `tests/cli/select-hook.test.ts`, `tests/resource/select-degrade.test.ts`, `tests/integration/selection.live.test.ts`.
7. `bunx biome check --write .` was run to autofix import-order and formatting drift across 26 files; all reformatted files included in the commit.

## Verification

- `bun run typecheck` → clean (no output).
- `bun run lint` → exit 0 (4 pre-existing warnings: `biome.json` deprecation INFO + 3 `noNonNullAssertion` in prior-slice test files; none from Task 11 code).
- `bun test` → 119 pass / 10 skip / 0 fail.
- `grep -rn "REGISTRY" src/ models/ tests/` → no matches.
- `chat.ts` still warms and pins `qwenRouter` before `createSelectHook`, and calls `manager.unloadAll()` in the outer `finally`.

## Concerns

None. The biome autofix reformatted many pre-existing `src/discovery/` and `src/runtime/` files alongside the Task 11 targets. These are all safe formatting-only changes (line breaks, import order) consistent with project style; they were included in the commit per the brief's `git add models/ src/ tests/ package.json` instruction.
