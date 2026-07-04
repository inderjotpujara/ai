# Task 11 report: MLX control surface via injectable factory (Slice 18 debt wrap-up)

## Summary

Refactored `src/runtime/mlx-server.ts` to export `createMlxServerRuntime(deps?)`
— an injectable factory taking `{ baseUrl?, fetchImpl? }` — with
`mlxServerRuntime = createMlxServerRuntime()` kept as the default export for
existing callers. Filled the control surface as far as the OpenAI-compatible
`/models` endpoint honestly allows, without fabricating any values.

## Changes

### `src/runtime/mlx-server.ts`

- **`createMlxServerRuntime(deps?: { baseUrl?: string; fetchImpl?: typeof fetch })`**:
  new factory. `baseUrl` defaults to `MLX_BASE_URL` (`process.env.MLX_BASE_URL`
  or `http://localhost:1234/v1`, computed live, not hardcoded). The fetch
  implementation is resolved **per call** via `getFetch() => deps?.fetchImpl ?? fetch`
  rather than captured once at factory-construction time — this matters because
  the existing test swaps `globalThis.fetch` *after* the module's default
  `mlxServerRuntime` singleton was already constructed at import time; capturing
  `fetch` once in the closure would have pinned the pre-swap reference and broken
  that test (caught this exact bug during the RED→GREEN cycle).
- **`listModels()`**: new shared helper (replaces `listIds`'s inline fetch) that
  fetches `${baseUrl}/models` and returns the full model entries, not just ids.
  Degrades to `[]` on fetch failure or non-OK response — never throws.
- **`listIds()`**: now derived from `listModels()` (`.map(m => m.id)`).
- **`getModelMax(m)`**: looks up the model's entry from `listModels()` and reads
  a context-length field via `contextLengthOf()`, which checks
  `max_context_length ?? context_length ?? max_model_len` (covers LM Studio and
  vLLM-style extensions to the OpenAI `/models` schema). Returns `undefined` if
  the entry is missing or exposes none of these fields — no invented numbers.
- **`listLoaded()`**: now maps real entries via `sizeBytesOf()`, which reads
  `size_bytes ?? size` and falls back to `0` only when neither is present
  (honest fallback, not fabricated).
- **`isInstalled`**: unchanged behavior (`(await listIds()).includes(m)`), now
  backed by the shared `listModels()`.
- **`pull(m)`**: unchanged behavior — returns if already in `listIds()`, else
  throws the existing clear error. Per the brief, investigated whether the
  OpenAI-compatible surface has a conventional "load a model" endpoint; it does
  not (LM Studio's load is a GUI/CLI action, not a documented REST call), so
  there's nothing reliable to attempt — the throw is the correct, honest
  behavior. Documented this reasoning inline as a comment.
- **`warm`/`unload`**: kept as safe no-ops (server owns lifecycle).
- **`getModelKvArch`**: kept `undefined` — MLX servers don't expose
  llama.cpp-style architecture/attention metadata.
- **`embed`**: kept throwing `MemoryError` (unsupported).
- `MlxModelEntry`/`MlxModelsResponse` types added (`type`, not `interface`, per
  repo style) to model the `/models` payload shape generically across server
  implementations.

### `tests/runtime/mlx-server.test.ts`

Kept both pre-existing tests (kind/model-build assertion, and the
`globalThis.fetch`-based `isInstalled` test) passing unmodified, and added,
using `createMlxServerRuntime({ fetchImpl })`:

- `getModelMax returns the exposed context length when present` — asserts
  `max_context_length`/`context_length` are read correctly, and `undefined` is
  returned when a model entry has no such field or the model id isn't found.
- `listLoaded maps ids and reports sizes when present` — asserts `size_bytes`/
  `size` are surfaced, and the `sizeBytes: 0` fallback for entries with no size
  field.
- `isInstalled works against the injected fetch` — sanity check the injectable
  path works independent of the global-fetch test.
- `a metadata fetch failure degrades to undefined/[] instead of throwing` — a
  `fetchImpl` that throws; asserts `getModelMax` → `undefined`, `listLoaded` →
  `[]`, `isInstalled` → `false`, `isAvailable` → `false` (no method throws).
- `a non-ok /models response degrades to undefined/[] instead of throwing` —
  fetch resolves with HTTP 500; same degrade assertions.

TDD: ran the new tests against the pre-refactor stubs first (RED — `getModelMax`
returned `undefined` unconditionally and `listLoaded` always reported
`sizeBytes: 0`), then implemented the factory + real field reads (GREEN). Along
the way, first-draft `getFetch`/closure design broke the pre-existing
`globalThis.fetch`-swap test (captured `fetch` once at construction) — fixed by
resolving `deps?.fetchImpl ?? fetch` lazily per call instead.

## Verification (inline only, per instructions — full suite not run)

- `bun run typecheck` → 0 errors.
- `bun run test:file -- "tests/runtime/mlx-server.test.ts"` → **7 pass, 0 fail,
  17 expect() calls**.
- `bun run lint:file -- "src/runtime/mlx-server.ts" "tests/runtime/mlx-server.test.ts"`
  → clean (ran biome's auto-fixer once for two formatting-only wraps; no logic
  changes).

## Notes / concerns

- No new dependencies added.
- No hardcoded model/context-length values — all metadata is read live from the
  injected/base URL's `/models` response; base URL itself still resolves from
  `MLX_BASE_URL` env var with a documented default, per existing convention.
- The full 491/3/0-pass suite was intentionally **not** run per task
  instructions (caller runs it after commit).
- This `task-11-report.md` path previously held a stale report from an earlier
  slice's differently-numbered Task 11 (an in-repo faithfulness eval gate from
  Slice 13) — it has been overwritten with this task's content, consistent
  with how that file itself documented the same convention.

## Commit
`feat(runtime): fill MLX control surface (getModelMax/listLoaded/pull best-effort) via injectable factory` on branch `slice-18-debt-wrapup-mlx`.
