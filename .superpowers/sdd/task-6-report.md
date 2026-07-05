# Task 6 report — LM Studio inference-runtime strategy via `@lmstudio/sdk`

## Status: DONE

## Commits
- `b9e4360` — feat(runtime): LM Studio inference runtime via @lmstudio/sdk (reload context)
- `a8b714c` — fix(runtime): probe LM Studio reachability over REST, not the SDK client

## What was built

- Ran `bun add @lmstudio/sdk` — landed `@lmstudio/sdk@1.5.0` in `package.json` `dependencies` and `bun.lock` (transitive: `@lmstudio/lms-isomorphic`, `ws`, `chalk`, `jsonschema`, `zod-to-json-schema`).
- `src/runtime/strategies/lmstudio.ts`:
  - `export type LmStudioClient = { load(model, ctx?): Promise<void>; unload(model): Promise<void>; listLoaded(): Promise<string[]>; reachable(): Promise<boolean> }` — the injectable seam, exactly as specified.
  - `export function makeLmStudioStrategy(getClient: () => LmStudioClient): RuntimeStrategy` — `kind: RuntimeKind.LmStudio`, `contextCapability: 'reload'`, `defaultPort: 1234`, `healthPath: '/v1/models'`, `basePath: '/v1'`, no `launch`. `daemonLoad(model, numCtx)` → `getClient().load(model, numCtx)` then returns `{ baseUrl: 'http://127.0.0.1:1234/v1' }`; `daemonUnload(model)` → `getClient().unload(model)`; `detect()` → `getClient().reachable()`.
  - `createDefaultLmStudioClient()` — the real-SDK-backed default client, all SDK usage isolated to this one file.
  - `export const lmStudioStrategy = makeLmStudioStrategy(getDefaultClient)` + `export const lmStudioRuntime = createManagedRuntime(lmStudioStrategy)`.
- `src/runtime/registry.ts` — appended `lmStudioRuntime` to `RUNTIMES` (order preserved: ollama, mlx-server, llama.cpp, lm-studio).
- `tests/runtime/lmstudio-runtime.test.ts` — the brief's failing test plus 3 more (daemonUnload, detect() reachable/unreachable, static config fields), all using a fake `LmStudioClient`. Adapted the brief's exact test body to avoid non-null assertions (`daemonLoad!`) since the project's Biome config forbids `noNonNullAssertion` — used the same narrowing-helper pattern already established in `tests/runtime/llamacpp.test.ts`.

## Exact `@lmstudio/sdk` API bound to (v1.5.0, read directly from `node_modules/@lmstudio/sdk/dist/index.d.ts`)

- `new LMStudioClient(opts?)` — `opts.logger?: LoggerInterface` etc. No `baseUrl` passed (defaults to guessing localhost ports).
- `client.llm` is a `LLMNamespace extends ModelNamespace<LLMLoadModelConfig, LLMInstanceInfo, LLMInfo, LLMDynamicHandle, LLM>`, exposing:
  - `load(modelKey: string, opts?: BaseLoadModelOpts<LLMLoadModelConfig>): Promise<LLM>` — `opts.config?: LLMLoadModelConfig` and `LLMLoadModelConfig.contextLength?: number`. Bound as `client.llm.load(model, { config: ctx ? { contextLength: ctx } : undefined })` — matches the plan's guess exactly.
  - `unload(identifier: string): Promise<void>` — bound as `client.llm.unload(model)`.
  - `listLoaded(): Promise<Array<LLM>>` — each `LLM` has `readonly identifier: string`; bound as `.map(m => m.identifier)`.
- **Deviation from the brief's guessed `detect()`:** the brief suggested SDK-client reachability (or `lms` CLI presence). I initially wired `detect()`/`reachable()` to `client.system.getLMStudioVersion()` (confirmed to exist: `SystemNamespace.getLMStudioVersion(): Promise<{version, build}>`), wrapped in a timeout race. **Live-verified this was a bad default**: merely constructing `new LMStudioClient()` when no daemon is listening eagerly opens a WebSocket and starts a background reconnect loop that prints a boxed "Failed to connect to LM Studio" error (via `chalk`/`boxen`) on a ~1s repeating timer for the life of the process — and this happens even with `logger: <silent no-op>` passed to the constructor (the box bypasses the `logger` option entirely; reproduced by direct `bun -e` script, both via `getLMStudioVersion()` and via bare construction with zero method calls). Since `detect()`/`isAvailable()` is exactly the kind of check `availableRuntimes()` runs routinely, this would spam stderr indefinitely for every user who doesn't have LM Studio installed. Fixed in the second commit: `reachable()` now does a plain, silent `fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(probeTimeoutMs()) })` — same pattern already used by `src/runtime/ollama.ts`/`mlx-server.ts` — and the real `LMStudioClient` is now constructed lazily, only inside `load`/`unload`/`listLoaded`, i.e. only once this runtime is actually selected to warm/unload a model. Live-verified after the fix: `lmStudioStrategy.detect()` returns `false` in ~9ms with zero console output (no LM Studio running on this machine).

## Test summary

- `bun test tests/runtime/lmstudio-runtime.test.ts` — 4 pass, 0 fail, 11 expect() calls.
- `bun test tests/runtime/` (full dir, 6 files incl. registry.test.ts which iterates `RUNTIMES`) — 38 pass, 0 fail, 75 expect() calls.
- `bun run typecheck` — clean.
- `bun run lint:file src/runtime/strategies/lmstudio.ts src/runtime/registry.ts tests/runtime/lmstudio-runtime.test.ts` — clean.
- Live-verified (no mocks): `lmStudioStrategy.detect()` against a real, freshly-installed `@lmstudio/sdk@1.5.0` with no LM Studio daemon running → returns `false` in 9ms, no stderr output.

## Concerns / follow-ups for the reviewer

1. **SDK version installed:** `@lmstudio/sdk@1.5.0` (latest at install time, 2026-07-05).
2. **Untested against a real running LM Studio daemon** (none available in this environment) — the `load`/`unload`/`listLoaded` bindings are verified against the SDK's shipped `.d.ts` signatures only, not exercised live. If Slice 26's live-verify gate expects an actual LM Studio install, that check should happen on a machine that has it.
3. The noisy-reconnect-loop finding above is specific to `@lmstudio/sdk@1.5.0`'s `LMStudioClient` constructor/WS layer; if a future SDK bump changes this behavior, the `reachable()`-via-REST design is still the more conservative default and shouldn't need to change.
4. `createManagedRuntime`'s `stopCurrent()` calls `strategy.daemonUnload(current.model)` whenever `current` is set (including right before a new `daemonLoad`, i.e. on every model switch) — so switching models on LM Studio incurs an SDK `unload` + `load` round trip each time. This matches the existing `daemonLoad`/`daemonUnload` contract from `managed-openai-compatible.ts` (Task 3) and is not something this task's scope changes.
