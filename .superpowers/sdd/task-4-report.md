# Task 4 report: Embeddings port (`RuntimeControl.embed` + probe + manager-backed wrapper)

## Status: DONE

Commit: `dde9348` — "feat(memory): embeddings via runtime port (weights-only, manager-backed)" on branch `slice-12-memory-rag`.

## Implemented

1. **`src/runtime/runtime.ts`** — added `embed(model: string, texts: string[]): Promise<number[][]>` to `RuntimeControl`.

2. **`src/runtime/ollama.ts`** — added `ollamaEmbed(model, texts)`, built on AI SDK v6 `embedMany` + `ollama-ai-provider-v2`'s `createOllama({ baseURL })`. Reused the existing `/api` baseURL convention (`http://localhost:11434/api`, matching `src/providers/ollama.ts`). Wired as `control.embed`.

3. **`src/runtime/mlx-server.ts`** — `control.embed` throws `MemoryError('embeddings are not supported on the MLX runtime yet')`.

4. **`src/memory/embed.ts`** (new) — `embedderDecl(model)`, `probeEmbedder(model, baseUrl?)`, `EmbedderDeps` type, `makeEmbedder(deps)`. No bogus self-import; `embedderDecl` defined locally as specified in the brief.

## Provider accessor verified

Inspected `node_modules/ollama-ai-provider-v2/dist/index.d.ts` (installed `3.6.0`) directly rather than trusting the brief's guess. The `OllamaProvider` interface exposes three embedding-related methods:
- `embedding(modelId, settings?)` — current, non-deprecated
- `textEmbedding(modelId, settings?)` — **@deprecated**, use `textEmbeddingModel` instead
- `textEmbeddingModel(modelId, settings?)` — current, non-deprecated

Used **`textEmbeddingModel`**, exactly as the brief's sketch specified — confirmed correct and not the deprecated alias.

## `ModelDeclaration` fields filled (from `src/core/types.ts`)

`ModelDeclaration` requires: `provider`, `model`, `params` (a `ModelParams` object — required, not optional), `role`, `footprint: { approxParamsBillions, bytesPerWeight, kvBytesPerToken? }`. Optional: `capabilities`, `contentPolicy`, `maxContext`.

`embedderDecl(model)` returns:
```ts
{
  provider: ProviderKind.Ollama,
  model,
  params: {},                 // no numCtx override — manager falls back to MIN_CTX
  role: 'embedder',
  footprint: {
    approxParamsBillions: 0.6,
    bytesPerWeight: 1,
    kvBytesPerToken: 0,        // weights-only — no KV budget reserved
  },
}
```
No `as ModelDeclaration` cast was needed — the object satisfies the type directly once all mandatory fields are present. Confirmed `model-manager.ts`'s `ensureReady` only reads `decl.params.numCtx` (optional-chained via `??`), `decl.model`, and `decl.footprint.*`, so an empty `params: {}` and `kvBytesPerToken: 0` are safe inputs.

## `probeEmbedder`

Mirrors `getModelMaxContext`/`getModelKvArch` in `src/runtime/ollama-control.ts`: `POST /api/show` with `{ model }`, reads `model_info['general.architecture']` then `model_info['<arch>.embedding_length']` (dim) and `model_info['<arch>.context_length']` (maxInput), with fallback defaults (768 / 2048) if unreported. Not unit-tested per the brief (live-Ollama-gated; deferred to Task 12's live test).

## TDD

- **RED**: wrote `tests/memory/embed.test.ts` (using `bun:test`, matching this repo's actual test runner — the brief's sketch showed `vitest`, which is not used here; verified via `tests/memory/define.test.ts` and other existing memory tests) importing `embedderDecl` before the module existed. Ran `bun test tests/memory/embed.test.ts` → failed with `Cannot find module '../../src/memory/embed.ts'`.
- **GREEN**: implemented all four files; `bun test tests/memory/embed.test.ts` → 2 pass, 6 expect() calls.

Test asserts: `model` echoed, `provider === ProviderKind.Ollama`, `footprint.kvBytesPerToken === 0`, `footprint.approxParamsBillions > 0`, `role` truthy, `params` deep-equals `{}`.

## Regression fix (required, not optional)

Adding `embed` to `RuntimeControl` is a breaking type change — every object typed as `RuntimeControl` needs the field. `bun run typecheck` caught 4 pre-existing test files building mock `RuntimeControl` fixtures without it:
- `tests/resource/model-manager-kv.test.ts`
- `tests/resource/model-manager.test.ts`
- `tests/resource/select-degrade.test.ts`
- `tests/resource/warm-reuse.test.ts`

Added `embed: mock(async () => [])` to each fixture (alongside the existing `getModelKvArch` mock). These were included in the same commit since they're required for the codebase to compile — not scope creep, a direct consequence of the type change the task specifies.

## Verification run

- `bun test tests/memory/embed.test.ts` → 2 pass
- `bun run typecheck` → clean (`tsc --noEmit`, no errors)
- `bun run lint:file` on all 9 touched files → clean after one `biome check --write` pass (import-order + one line-wrap auto-fix; no manual logic changes from lint)
- **Full suite**: `bun test` → **229 pass, 16 skip, 0 fail** (245 tests across 81 files) — no regression vs. pre-task baseline (skips are pre-existing live-service-gated tests, unrelated to this change)
- `bun run docs:check` → passes (`src/memory/` already documented in `docs/architecture.md`'s Slice 12 stub from an earlier task; no new subsystem directory introduced)

## Self-review / concerns

- **Provider accessor**: confirmed by reading the installed package's `.d.ts` directly rather than trusting the brief — `textEmbeddingModel` is correct and current (not the deprecated `textEmbedding`).
- **`ModelDeclaration.params: {}`**: leaves `numCtx` unset for the embedder decl, so `ensureReady` defaults to `MIN_CTX`. This seems right for a weights-only model — no deliberate context cap is needed since `kvBytesPerToken: 0` makes the KV term contribute zero bytes to the budget regardless of chosen context. Flagging for review in case a later task (e.g. Task 12, wiring live embed calls) wants an explicit `numCtx` for embedding batch-size reasons.
- **`role: 'embedder'`**: chosen as a plain descriptive string (matches the free-text `role: string` field pattern used elsewhere, e.g. `role: 'test'` / `role: 't'` in existing test fixtures). No enum exists for this since `role` is documented as a "human description," not a hard-filtered field.
- **Test runner mismatch in the brief**: the brief's Step 1 sketch imports `describe/expect/test` from `'vitest'`; this repo's actual convention (per `tests/memory/define.test.ts`, `budget.test.ts`, `spans.test.ts`, and `package.json` test scripts) is `bun:test`. Used `bun:test` — flagging in case the discrepancy is a signal about a planned test-runner migration, though nothing else in the repo suggests one.
- **`probeEmbedder` is untested** in this task, per explicit brief instruction (live-Ollama-gated; Task 12 covers it live). No unit test added for it here.
- **Did not touch** `docs/architecture.md`, `README.md`, or `docs/ROADMAP.md` — this is a mid-slice task commit, not the slice-landing commit; the standing "all four surfaces" rule applies at slice completion, and `src/memory/` is already present in architecture.md from an earlier task's stub. Flagging so the slice's final review knows to verify the embeddings capability gets folded into the architecture.md Slice 12 section language once the full RAG pipeline lands.

## Files touched

- `/Users/inderjotsingh/ai/src/runtime/runtime.ts`
- `/Users/inderjotsingh/ai/src/runtime/ollama.ts`
- `/Users/inderjotsingh/ai/src/runtime/mlx-server.ts`
- `/Users/inderjotsingh/ai/src/memory/embed.ts` (new)
- `/Users/inderjotsingh/ai/tests/memory/embed.test.ts` (new)
- `/Users/inderjotsingh/ai/tests/resource/model-manager-kv.test.ts`
- `/Users/inderjotsingh/ai/tests/resource/model-manager.test.ts`
- `/Users/inderjotsingh/ai/tests/resource/select-degrade.test.ts`
- `/Users/inderjotsingh/ai/tests/resource/warm-reuse.test.ts`
