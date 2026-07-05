# Task 5 Report: MLX strategy + rewrite `mlx-server.ts` onto the managed base

## Status
COMPLETE — implementation, tests, typecheck, and lint were already committed on this
branch (`4491fe8`) before this session started. This session re-verified the work
end-to-end against the task-5 brief and found it correct and complete; this report
replaces a stale `task-5-report.md` left over from an earlier slice's unrelated
"Timeouts" task (same filename, different slice — confirmed via
`git log -- .superpowers/sdd/task-5-report.md`, last touched at `68c4ae4`).

## What shipped

### `src/runtime/strategies/mlx.ts` (new)
- `createMlxStrategy(deps?: { which? })` returns a `RuntimeStrategy`:
  - `kind: RuntimeKind.MlxServer`
  - `contextCapability: 'fixed'` — `mlx_lm.server` has no context-length flag,
    so `numCtx` is never threaded through.
  - `defaultPort: 1234`, `healthPath: '/v1/models'`, `basePath: '/v1'`
  - `launch(model, _numCtx, port)` → `{ cmd: 'mlx_lm.server', args: ['--model', model, '--host', '127.0.0.1', '--port', String(port)], port }` — uses the passed `port`, never hardcodes it.
  - `detect()` — probes the configured `MLX_BASE_URL` (default `http://localhost:1234/v1`) `/models` endpoint first (preserves the pre-existing env-based reachability check); falls back to `Bun.which('mlx_lm.server') != null` (injectable via `deps.which` for tests).
- `mlxStrategy` — the default-constructed singleton export.

### `src/runtime/mlx-server.ts` (rewritten)
- No longer builds its own `createOpenAICompatible` provider or duplicates
  `MlxModelEntry` / `contextLengthOf` / `sizeBytesOf` — those now live solely in
  `managed-openai-compatible.ts` (imported there, not re-declared here).
- `createMlxServerRuntime(deps: MlxServerDeps = {})`:
  - If `deps.baseUrl` (or `MLX_BASE_URL` env) is set: builds an
    `externalServerStrategy` — a copy of `mlxStrategy` with `defaultPort`/`basePath`
    derived from the URL, `detect()` re-pointed at the injected `fetchImpl`, and
    `daemonLoad()` returning `{ baseUrl }` directly (no spawn). This is the
    exact "server already running" compat path the existing tests depend on.
  - Otherwise: delegates straight to `createManagedRuntime(mlxStrategy, { fetchImpl, spawn })` — spawn-on-warm only happens in this branch.
  - `MlxServerDeps` extended with optional `spawn?: SpawnFn` (in addition to the
    pre-existing `baseUrl?` / `fetchImpl?`).
- `mlxServerRuntime = createMlxServerRuntime()` — unchanged export shape.
- `embed` continues to throw `MemoryError` — now sourced from the shared base
  (`managed-openai-compatible.ts` line ~214), not duplicated locally.

### `src/runtime/registry.ts`
- No change needed — `mlxServerRuntime` was already the single registered
  entry; MLX now happens to be backed by the managed base under the hood.

### `tests/runtime/mlx-server.test.ts`
- All 7 pre-existing tests kept **verbatim, unchanged, and passing**:
  1. `mlx runtime has the right kind and builds a model`
  2. `isInstalled reads /v1/models`
  3. `getModelMax returns the exposed context length when present`
  4. `listLoaded maps ids and reports sizes when present`
  5. `isInstalled works against the injected fetch`
  6. `a metadata fetch failure degrades to undefined/[] instead of throwing`
  7. `a non-ok /models response degrades to undefined/[] instead of throwing`
- One new test added per the brief's Step 1:
  8. `mlx warm spawns mlx_lm.server when no external base url is set` — injects
     a fake `spawn` and a healthy fetch, calls `createMlxServerRuntime({ spawn, fetchImpl: health })` (no `baseUrl`), calls `rt.control.warm('m', 8192)`, asserts `spawn` was invoked with `'mlx_lm.server'`.

## TDD sequence (as run this session)
1. Baseline: `bun test tests/runtime/mlx-server.test.ts` → **8 pass** (the spawn
   test was already present in the file and the implementation from the prior
   commit already satisfies it — no red step was observed this session since
   the work predates it; re-verified the compat contract line-by-line against
   the diff in `4491fe8` instead).
2. Reviewed `git show 4491fe8 -- src/runtime/mlx-server.ts` to confirm the
   before/after: old code built its own `createOpenAICompatible` provider and
   duplicated the model-entry parsing helpers; new code has neither — it's a
   thin strategy + compat shim over `createManagedRuntime`.
3. Confirmed `embed`/`MemoryError`, `createModel`, and `kind` are all supplied
   centrally by `managed-openai-compatible.ts`, not re-implemented in
   `mlx-server.ts`.

## Checks (this session, on branch `slice-26-altruntime-remote-auth`, HEAD `4491fe8`)
- `bun test tests/runtime/mlx-server.test.ts` → **8 pass, 0 fail, 18 expect() calls** — **every pre-existing assertion passes unchanged**, plus the new spawn test.
- `bun test tests/runtime/` (whole dir) → **34 pass, 0 fail, 62 expect() calls** across 5 files.
- `bun run typecheck` → clean, no errors.
- `bun run lint:file src/runtime/mlx-server.ts src/runtime/strategies/mlx.ts tests/runtime/mlx-server.test.ts` → `biome check` — no issues, no fixes applied.

## Compat contract verification (explicit)
- `deps.baseUrl` set (or `MLX_BASE_URL` env) → `externalServerStrategy` is used,
  `daemonLoad()` returns `{ baseUrl }` with **no spawn call** — matches
  "server already running, warm is a no-op reachability path" exactly as
  before the rewrite.
- No `baseUrl`/env → `createManagedRuntime(mlxStrategy, { fetchImpl, spawn })`
  is used, so `warm` goes through the base's real spawn-and-supervise path,
  calling `mlx_lm.server` with the strategy's `launch()` — verified by the new
  test.
- `contextCapability: 'fixed'` means `numCtx` is accepted by `warm()` but never
  turned into a CLI flag (`launch` ignores `_numCtx`).

## Commits
- `4491fe8` — `refactor(runtime): rewrite MLX onto the managed base (fixed-context, supervised)` (contains all three file changes: `mlx-server.ts`, `strategies/mlx.ts`, `mlx-server.test.ts`).

No additional commits were needed this session — the implementation, its tests,
typecheck, and lint were already correct and complete. This report and the
`.superpowers/sdd/progress.md` ledger entry are the only artifacts produced
this session.

## Concerns / follow-ups
- None outstanding for this task. The stale `task-5-report.md` mismatch
  (leftover from a different slice's task numbering) is now corrected; worth a
  quick sanity check on `task-1..4` briefs/reports too if a future audit finds
  more cross-slice filename collisions.
