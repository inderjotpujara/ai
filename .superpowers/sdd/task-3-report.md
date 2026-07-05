# Task 3 report — managed OpenAI-compatible runtime base

## Status: DONE

## What was built

`src/runtime/managed-openai-compatible.ts` — `createManagedRuntime(strategy, deps?)` returning a `Runtime`. It is the single owner of:

- spawn-and-poll lifecycle via `superviseServer` from Task 2 (`process-supervisor.ts`)
- daemon-load lifecycle (calls `strategy.daemonLoad`/`daemonUnload` directly, no process spawn)
- `warm(model, numCtx)` idempotency: reuses the current server if `(model, effectiveCtx)` is unchanged; otherwise stops the current server/daemon load and (re)launches
- fresh-port allocation on every (re)launch via an injectable `portAlloc?: () => Promise<number>` (defaults to a real `freePort()` that binds port 0, reads the OS-assigned port, and closes) — addresses the port-collision risk from Task 2's fire-and-forget `stop()`
- `fixed` capability: calls `strategy.launch(model, undefined, port)` — numCtx is never threaded to the launcher. Strengthened the brief's weak test (`fixed-capability strategy does not thread numCtx into the launcher`) to assert on what the strategy actually received (`seen` array), not just `rt.kind`
- `breakerFor('runtime:' + strategy.kind)` wraps `warm` only, per the cross-task decision
- `createModel` builds `createOpenAICompatible({ name: strategy.kind, baseURL: current?.baseUrl ?? fallbackBaseUrl })(decl.model)`, re-resolving the baseURL on each call so it always reflects the live warm state
- `control.isInstalled`/`listLoaded`/`getModelMax` reuse the `/models` introspection exactly as `mlx-server.ts` does today
- `control.getModelKvArch` → `undefined`; `control.embed` → throws `MemoryError`; `control.pull` → throws (downloads are provisioning-layer only)

Extracted and **exported** `MlxModelEntry`, `contextLengthOf`, `sizeBytesOf` into this new file verbatim from `src/runtime/mlx-server.ts` (that file is untouched — Task 5's MLX-strategy rewrite is expected to import from here and retire its own copies).

## Tests

`tests/runtime/managed-openai-compatible.test.ts` — 12 tests, all passing:
1. warm launches with the requested context (relaunch capability)
2. warm reuses the server for the same (model, ctx) — no relaunch
3. **added:** warm relaunches on a fresh port when model/ctx changes (proves the port-collision fix — two relaunches get two distinct ports from an injected `portAlloc`)
4. **strengthened:** fixed-capability strategy does not thread numCtx into the launcher (asserts the strategy's `launch` received `undefined`, not just `rt.kind`)
5. getModelMax reads /v1/models like the MLX adapter
6. **added:** daemonLoad path (LM Studio-style) warms without spawning a process
7. **added:** isAvailable delegates to strategy.detect
8. **added:** control.isInstalled reflects the runtime model list
9. **added:** control.pull throws — downloads are not managed here
10. **added:** control.embed throws MemoryError
11. **added:** control.getModelKvArch is undefined
12. **added:** control.unload stops the supervised server

All tests use a fake strategy + injected `spawn`/`fetchImpl` — no live server, no real port binding in the default path (relaunch/no-relaunch tests never trigger `freePort()` since they warm once or reuse).

## Verification run

- `bun test tests/runtime/managed-openai-compatible.test.ts` → 12 pass, 0 fail
- `bun test tests/runtime/` (full directory, incl. `mlx-server.test.ts`, `process-supervisor.test.ts`, `registry.test.ts`) → 26 pass, 0 fail — confirms `mlx-server.ts` wasn't disturbed
- `bun run typecheck` → clean
- `bun run lint:file src/runtime/managed-openai-compatible.ts tests/runtime/managed-openai-compatible.test.ts` → clean (after `biome check --write` reordered/reformatted imports)
- `bun run docs:check` → passes (no new subsystem directory added; `runtime/` already documented — the doc-surface update is deferred to slice landing per the multi-task SDD flow)

## Concerns / notes for downstream tasks

- Task 4/5/6 strategies that use `launch` (spawned processes) will get a **new** free port on every relaunch, not the strategy's `defaultPort`. `defaultPort` is only used for `fallbackBaseUrl` before any successful warm. This is intentional per the port-collision cross-task decision but worth flagging since it means `-c`/`--port` args baked into `launch()` must use the `port` argument passed in, not a hardcoded default.
- `contextCapability: 'reload'` (LM Studio) isn't given bespoke handling beyond "not fixed" — the base always does stop-then-daemonLoad on any (model, ctx) change, which matches the brief's literal instructions ("stop any current server... then daemonLoad path → call it"). If Task 6 wants a true in-place reload without a stop/unload round-trip, that will need a small base change at that point — flagging now so it isn't a surprise.
- `control.unload(model)`/`control.pull(model)` ignore the `model` argument structurally (there's only one "current" server per strategy instance) — matches `RuntimeControl`'s type via JS's fewer-params assignability; typecheck confirmed this is sound.
