# Task 3 Report: Retype the inference runtime registry + `Runtime.kind`

## Status
✅ COMPLETE

## Summary

Retyped the inference-runtime side (`Runtime.kind`, `runtimeFor`) from
`ProviderKind` to the new `RuntimeKind` (introduced in Task 1), following the
brief's TDD steps exactly.

## TDD steps followed

1. **Failing test written** — replaced `tests/runtime/registry.test.ts` (which
   pre-existed with an old `ProviderKind`-based API: `runtimeFor(ProviderKind)`,
   plus a "throws on unknown kind" case) with the brief's exact test content
   (2 `it` blocks under `describe('runtimeFor', …)`, asserting
   `runtimeFor(RuntimeKind.Ollama).kind === RuntimeKind.Ollama` and the MLX
   equivalent).
2. **Verified it fails** — `bun run test:file -- "tests/runtime/registry.test.ts"`
   failed with `error: No runtime registered for provider MlxServer` (1 pass /
   1 fail), confirming the pre-change registry didn't resolve `RuntimeKind`
   values correctly.
3. **Implemented the brief's edits:**
   - `src/runtime/runtime.ts`: import changed from `ProviderKind` to
     `RuntimeKind`; `Runtime.kind: RuntimeKind`.
   - `src/runtime/registry.ts`: import changed to `RuntimeKind`;
     `runtimeFor(kind: RuntimeKind): Runtime`; body (`RUNTIMES` array, `find`,
     throw message, `availableRuntimes`) left unchanged as instructed.
   - `src/runtime/mlx-server.ts`: import changed from `ProviderKind` to
     `RuntimeKind`; `kind: RuntimeKind.MlxServer`.
   - `src/runtime/ollama.ts`: import changed from `ProviderKind` to
     `RuntimeKind`; `kind: RuntimeKind.Ollama`.
4. **Verified it passes** — `bun run test:file -- "tests/runtime/registry.test.ts"`
   → `2 pass, 0 fail, 2 expect() calls`.
5. **Committed** — `git add src/runtime/ tests/runtime/registry.test.ts` +
   commit (see below). Only these 5 files were staged; the pre-existing
   uncommitted doc/ledger changes in the working tree (`.remember/now.md`,
   `.superpowers/sdd/progress.md`, `task-1-*`, `task-2-*`, `task-3-brief.md`)
   were left untouched/unstaged, as they belong to other tasks/sessions.

## Commit

- `101cdca` — `feat(runtime): retype runtimeFor + Runtime.kind to RuntimeKind`
  (5 files changed: `src/runtime/mlx-server.ts`, `src/runtime/ollama.ts`,
  `src/runtime/registry.ts`, `src/runtime/runtime.ts`,
  `tests/runtime/registry.test.ts`)

## Test result

`bun run test:file -- "tests/runtime/registry.test.ts"` → **2 pass, 0 fail**.

## Known / expected residual breakage (not touched, per brief)

- `tests/runtime/mlx-server.test.ts` line 6 still asserts
  `mlxServerRuntime.kind === ProviderKind.MlxServer`. Since `mlxServerRuntime.kind`
  is now `RuntimeKind.MlxServer` (string value `'MlxServer'`) while
  `ProviderKind.MlxServer` no longer exists as an enum member (`ProviderKind`
  now only has `Ollama`, `HfGguf`, `HfSnapshot`, `LmStudio` per Task 1), that
  assertion now compares against `undefined` and fails
  (`Expected: undefined, Received: "MlxServer"`). I ran this file only to
  confirm the expected-breakage boundary — it is a **separate test file**
  from `tests/runtime/registry.test.ts` (bun runs each test file as its own
  module; no shared compilation unit), so it did not affect or block the
  required focused run. Per the brief's guidance, since it did **not** break
  compilation of my focused registry test run, I left it untouched for Task 4
  to fix (update `ProviderKind.MlxServer` → `RuntimeKind.MlxServer` there).
- Full `bun test` / `bun run typecheck` remain RED due to the known Task-4
  consumers (`src/discovery/*`, `src/cli/select-hook.ts`,
  `src/resource/model-manager.ts`,
  `src/provisioning/catalog/hf-catalog.ts`) still referencing the removed
  `ProviderKind.MlxServer` / using `.provider` for runtime lookup — expected,
  not chased here, per instructions to run only the focused test.

## Note on this file

This report file previously held a stale Slice-17 Task-3 report
("generate.ts — structured proposal draft") from an earlier slice that reused
the same filename. It has been overwritten with this Slice-18 Task-3 report.

## Concerns

None. Scope was followed exactly as specified in the brief; no ambiguity
encountered.
