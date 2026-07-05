# Task 4 report — llama.cpp inference-runtime strategy

**Status:** DONE

## What shipped

- `src/runtime/strategies/llamacpp.ts` (new):
  - `createLlamaCppStrategy(deps?: LlamaCppDeps): RuntimeStrategy` — factory so
    `detect()`'s PATH lookup is injectable (`deps.which`, defaults to `Bun.which`)
    without depending on a real `llama-server` install in tests.
  - `llamaCppStrategy: RuntimeStrategy` — `kind: RuntimeKind.LlamaCpp`,
    `contextCapability: 'relaunch'`, `defaultPort: 8080`, `healthPath: '/health'`,
    `basePath: '/v1'`.
  - `detect()` → `which('llama-server') != null`.
  - `launch(model, numCtx, port)` → builds the `llama-server` invocation. **Always
    threads the passed `port`** into `--port` and into the returned `LaunchSpec.port`
    — never the strategy's `defaultPort` — since `createManagedRuntime` allocates a
    fresh free port per launch and passes it in.
  - `-hf` vs `-m` heuristic (`looksLikeHfRepoId`): a `/`-containing model string is
    treated as a local path (→ `-m`) if it starts with `/`, `./`, `../`, or `~`, or if
    it already exists on disk (`existsSync`); otherwise it's treated as an
    HuggingFace `org/repo[:quant]` id (→ `-hf`). Documented inline.
  - `llamaCppRuntime: Runtime = createManagedRuntime(llamaCppStrategy)`.
- `src/runtime/registry.ts` — imports `llamaCppRuntime` and appends it to
  `RUNTIMES` (now `[ollamaRuntime, mlxServerRuntime, llamaCppRuntime]`).
- `tests/runtime/llamacpp.test.ts` (new) — 7 tests: the 3 from the brief's Step 1
  sample plus 4 added for load-bearing/edge coverage:
  - launch uses the **passed** port (5555), not `defaultPort` (8080), in both
    `spec.port` and the `--port` arg — the cross-task contract called out in the
    dispatch.
  - `-c` is omitted entirely when `numCtx` is `undefined`.
  - `detect()` returns `true`/`false` correctly via the injectable `which` dep
    (no real install needed).

## TDD sequence

1. Wrote the test file first (module didn't exist) → ran `bun test
   tests/runtime/llamacpp.test.ts` → confirmed failure: `Cannot find module
   '../../src/runtime/strategies/llamacpp.ts'`.
2. Implemented the strategy + registry wiring.
3. First green-run attempt caught a real heuristic bug: `/abs/path.gguf` (a path,
   no leading `./`) was misclassified as an HF repo id because `existsSync`
   correctly returns `false` for a non-existent test path. Fixed by adding a
   `PATH_PREFIXES` check (`/`, `./`, `../`, `~`) ahead of the `existsSync` check,
   so unambiguous path syntax wins regardless of whether the file exists yet.
4. Lint caught two non-null-assertion (`launch!`) violations and a formatting
   nit in the test file (biome `noNonNullAssertion`); replaced with a small
   `launch()` test helper that narrows `strategy.launch` via an explicit throw
   instead of `!`, then ran `bunx biome format --write` to settle formatting.

## Verification (inline)

- `bun test tests/runtime/llamacpp.test.ts` → 7 pass, 0 fail, 14 expect() calls.
- `bun test tests/runtime/` (full directory, guards against breaking
  `registry.test.ts` / `managed-openai-compatible.test.ts`) → 33 pass, 0 fail.
- `bun run typecheck` → clean.
- `bun run lint:file src/runtime/strategies/llamacpp.ts src/runtime/registry.ts
  tests/runtime/llamacpp.test.ts` → clean (biome check, 0 errors).

## Self-review

- Confirmed `launch()` never references `strategy.defaultPort` in the args —
  only the `port` parameter — matching the CRITICAL cross-task contract (the
  base allocates a fresh free port per launch via `portAlloc()` in
  `managed-openai-compatible.ts`).
- Confirmed `createManagedRuntime`'s `doWarm` threads `launchCtx` (derived from
  `effectiveCtx`, which passes `numCtx` through unchanged for non-`'fixed'`
  capabilities) into `strategy.launch`, so llama.cpp's `-c` really does vary
  per-warm-call via relaunch — no change needed to the shared base for this.
- `registry.test.ts` was not modified; it doesn't hardcode `RUNTIMES.length`, so
  appending `llamaCppRuntime` doesn't break its "every registered runtime
  exposes control + model factory" loop assertion.
- No other files in the working tree (`.remember/`, `.superpowers/sdd/progress.md`,
  other task briefs/reports, `docs/ROADMAP.md`) were touched or staged by this
  task — those are being managed by the controller/other parallel tasks; only
  `src/runtime/strategies/llamacpp.ts`, `src/runtime/registry.ts`, and
  `tests/runtime/llamacpp.test.ts` were staged and committed.

## Commit

`407c2bf` — `feat(runtime): llama.cpp inference runtime (relaunch -c dynamic context)`
(3 files changed: `src/runtime/strategies/llamacpp.ts` new,
`tests/runtime/llamacpp.test.ts` new, `src/runtime/registry.ts` modified).

## Concerns / follow-ups for later tasks

- The `-hf`/`-m` heuristic is best-effort (documented in-code); if a caller ever
  passes a relative path like `models/q.gguf` that doesn't yet exist on disk, it
  will be misrouted to `-hf`. Not exercised by this task's tests since the brief
  didn't specify that case; flagging in case a later task (provisioning /
  selector) needs to pass relative paths.
- This strategy doesn't implement `daemonLoad`/`daemonUnload` (llama.cpp is
  spawn-only, per brief) — `createManagedRuntime` already handles that
  correctly via its `strategy.launch` branch.
