# Task 3 Report — Hardware-fit + downloadable catalog sources + snapshot fallback

## Status: DONE

## What was built

Per the brief (`/Users/inderjotsingh/ai/.superpowers/sdd/task-3-brief.md`), verbatim:

1. **`src/provisioning/fit.ts`** — `FitCandidate` type + `fitAndRank(candidates, budgetBytes)`:
   filters to fitting candidates (via `fitsBudget` + `estimateModelBytes`, taking `max(fileSizeBytes, estimated)`),
   sorts largest-params-first, marks the first candidate per `ProviderKind` as `recommended`.
2. **`src/provisioning/catalog/ollama-catalog.ts`** — `ollamaManifestSize(model, tag, fetchImpl?)` sums
   `layers[].size` + `config.size` from the Ollama registry manifest endpoint; throws `ProviderError` on
   fetch failure or non-200. `createOllamaCatalogSource(deps?)` builds a `CatalogSource` from the community
   `OllamaScraper` JSON list (lazy `fileSizeBytes: 0`, enriched later by Task 4 wiring).
3. **`src/provisioning/catalog/hf-catalog.ts`** — `hfTreeSize(repoId, opts, fetchImpl?)` fetches the HF tree
   API; returns one file's size when `opts.file` is given (llama.cpp/GGUF case), else sums the whole tree
   (MLX snapshot case). `createHfCatalogSource(kind, deps?)` builds a `CatalogSource` searching HF by filter
   (`gguf` default, `mlx` for `ProviderKind.MlxServer`). `HF_TOKEN` is read from `process.env` only as a
   fallback — anonymous when absent, never required.
4. **`src/provisioning/catalog/snapshot.json`** — committed floor catalog, brief's JSON verbatim (4 entries:
   qwen3.5:4b, qwen3.5:9b, qwen3-embedding:0.6b, bespoke-minicheck), reformatted (multi-line) by biome's
   formatter — data values unchanged, purely pretty-printing to satisfy repo lint.
5. **`src/provisioning/catalog/snapshot-source.ts`** — `loadSnapshot()` maps the JSON into `Candidate[]`;
   `createSnapshotSource()` wraps it as a `CatalogSource`; `withSnapshotFallback(source, fallback)` tries the
   live source and falls back to `fallback.listCandidates(q)` on empty result or ANY thrown error — never
   throws for a source failure (degrade-never-crash).

All network calls take an injected `fetchImpl` (default `fetch`); no test hits the real network.

## RED -> GREEN TDD evidence

Each file was test-first: test written, run to confirm `Cannot find module` (RED), then implementation
written, then run to confirm PASS (GREEN).

1. `fit.test.ts` — RED: `error: Cannot find module '../../src/provisioning/fit.ts'`.
   GREEN after `fit.ts`: `3 pass / 0 fail` (5 expect calls).
2. `ollama-catalog.test.ts` — RED: `Cannot find module '.../ollama-catalog.ts'`.
   GREEN after `ollama-catalog.ts`: `2 pass / 0 fail`.
3. `hf-catalog.test.ts` — RED: `Cannot find module '.../hf-catalog.ts'`.
   GREEN after `hf-catalog.ts`: `2 pass / 0 fail`.
4. `snapshot-source.test.ts` — RED: `Cannot find module '.../snapshot-source.ts'`.
   GREEN after `snapshot.json` + `snapshot-source.ts`: `2 pass / 0 fail` (3 expect calls).

Final combined run: `bun test tests/provisioning/` → **39 pass, 0 fail, 57 expect() calls** across all 9
provisioning test files (includes pre-existing Task 1/2 tests, unaffected).

`bun run typecheck` → clean (`tsc --noEmit`, no output/errors).

`bun run lint:file -- src/provisioning/fit.ts src/provisioning/catalog/*.ts src/provisioning/catalog/snapshot.json`
→ clean after two fixups (see Self-review below).

## Files changed (all new)

- `/Users/inderjotsingh/ai/src/provisioning/fit.ts`
- `/Users/inderjotsingh/ai/src/provisioning/catalog/ollama-catalog.ts`
- `/Users/inderjotsingh/ai/src/provisioning/catalog/hf-catalog.ts`
- `/Users/inderjotsingh/ai/src/provisioning/catalog/snapshot.json`
- `/Users/inderjotsingh/ai/src/provisioning/catalog/snapshot-source.ts`
- `/Users/inderjotsingh/ai/tests/provisioning/fit.test.ts`
- `/Users/inderjotsingh/ai/tests/provisioning/ollama-catalog.test.ts`
- `/Users/inderjotsingh/ai/tests/provisioning/hf-catalog.test.ts`
- `/Users/inderjotsingh/ai/tests/provisioning/snapshot-source.test.ts`

Commit: `d34067b` on branch `slice-14-provisioning` — "feat(provisioning): hardware-fit + downloadable
catalog sources + snapshot fallback (Slice 14 Task 3)".

## Self-review findings

- **Type conformance verified before writing code**: read `src/discovery/catalog-source.ts`,
  `src/resource/footprint.ts`, `src/resource/hardware.ts`, `src/core/types.ts`, `src/core/errors.ts` first.
  All match the brief's assumed shapes exactly (`Candidate = ModelDeclaration & {repo, quant?, fileSizeBytes,
  downloads, installed}`, `fitsBudget(modelBytes, budgetBytes)`, `estimateModelBytes(FootprintInput)`,
  `ProviderKind` string enum, `ProviderError extends FrameworkError`). No conflicts — implemented the brief's
  code verbatim.
- **Two lint fixups beyond the brief's literal code** (both mechanical, no logic change):
  1. Biome's `useImportType`/`noUnusedImports`/formatter auto-fixed `import { X }` → `import type { X }` and
     reflowed multi-line signatures/objects across all 4 `.ts` files (`bunx biome check --write`).
  2. `ContentPolicy` was imported in `snapshot-source.ts` per the brief's snippet but never referenced in the
     file body (only `Capability` and `ProviderKind` are used) — biome flagged it as a genuine unused import
     (not an unsafe/type-only issue); removed it manually. This is a real dead import in the brief's sample,
     not a functional deviation.
  3. `snapshot.json` was reformatted (one-field-per-line) by biome's JSON formatter; all field values are
     byte-for-byte identical to the brief's JSON, only whitespace/layout changed.
- **No `console.log`** in any new `src/` file (grep confirmed).
- **No new npm dependency** — only `fetch` (global) and standard TS/JSON imports.
- **`docs:check` still passes** — `src/provisioning` was already a documented subsystem from Tasks 1-2; this
  task adds files within it, not a new subsystem, so no `architecture.md` edit was required for this task
  (the slice-level doc update is expected at final slice wrap-up per the project's hard-line rule).
- Committed only the exact file set the brief's Step 13 lists; left other modified/untracked files (memory,
  `.superpowers/sdd/progress.md`, other task briefs, `.remember/*`) untouched as they belong to
  other tasks/sessions, not Task 3.

## Concerns

None blocking. Minor observations for later tasks/reviewers:
- `ollama-catalog.ts` and `hf-catalog.ts` both produce candidates with `fileSizeBytes: 0` and
  `approxParamsBillions: 0` placeholders (by design per the brief's Step-5 note) — Task 4's enrichment wiring
  is required before `fitAndRank` can meaningfully rank these discovered (non-snapshot) candidates; until
  then only the snapshot source carries accurate sizing data.
- `withSnapshotFallback` falls back both on thrown error AND on an empty live result (`live.length > 0 ? live
  : fallback(...)`), which is slightly broader than "on error" alone but matches the brief's given
  implementation and is arguably the more robust behavior (a live source returning zero candidates is
  operationally indistinguishable from a failure for provisioning purposes).

## Task 3 review-fix

**Finding:** `fitAndRank` could mark an unenriched placeholder candidate (`approxParamsBillions === 0`,
`fileSizeBytes === 0` — exactly what `createOllamaCatalogSource`/`createHfCatalogSource` emit pre-Task-4
enrichment) as `recommended: true`. Cause: `estimateModelBytes` still adds a KV-cache term
(`kvCacheBytes(8192, 131072)` ≈ 1.07 GB) independent of params, so the 0/0 placeholder passes `fitsBudget`
under almost any host budget. If it's the only (or first) fitting candidate for its `ProviderKind`, it was
selected as the per-provider `recommended` pick — and recommended models drive the default download
set — pre-selecting a phantom ref with zero real sizing evidence.

**Guard added** (`src/provisioning/fit.ts`): a new `hasNoSizingSignal(c)` helper —
`c.fileSizeBytes <= 0 && c.footprint.approxParamsBillions <= 0` — and a `continue` at the top of the
recommended-marking loop for any candidate matching it. Such candidates are still filtered/sorted/returned
in the list (so Task 4 enrichment / UI can still act on them) but can never consume the `seen` slot for
their provider or be marked `recommended`. Since the list is sorted by params desc, any real candidate
(params > 0) for the same provider sorts ahead of a 0/0 placeholder and remains eligible to become
recommended, unaffected by the guard.

**Tests added** (`tests/provisioning/fit.test.ts`, TDD — written first, confirmed RED, then GREEN):
1. `'never recommends a lone 0-params/0-size placeholder candidate'` — a single Ollama-shaped placeholder
   candidate (`cand('placeholder', 0, 0)`) is returned in the output list but `recommended === false`.
2. `'recommends the real candidate over a 0/0 placeholder for the same provider'` — given both a 0/0
   placeholder and a real candidate (`params=7, size=5e9`) for `ProviderKind.Ollama`, the real one is
   `recommended: true` and the placeholder stays `recommended: false`.
3. Regression: all 3 pre-existing tests (budget filtering, ranking, top-per-runtime recommended for real
   candidates) unchanged and still pass.

**RED (before the fix)** — `bun test tests/provisioning/fit.test.ts`:
```
tests/provisioning/fit.test.ts:
27 |     const out = fitAndRank([cand('placeholder', 0, 0)], 1e12);
...
error: expect(received).toBe(expected)
Expected: false
Received: true
      at <anonymous> (/Users/inderjotsingh/ai/tests/provisioning/fit.test.ts:29:69)
(fail) fitAndRank > never recommends a lone 0-params/0-size placeholder candidate

 4 pass
 1 fail
 9 expect() calls
Ran 5 tests across 1 file. [18.00ms]
```

**GREEN (after the fix)** — `bun test tests/provisioning/fit.test.ts`:
```
bun test v1.3.11 (af24e281)

 5 pass
 0 fail
 9 expect() calls
Ran 5 tests across 1 file. [17.00ms]
```

**Full provisioning suite** — `bun test tests/provisioning/`:
```
bun test v1.3.11 (af24e281)
 41 pass
 0 fail
 61 expect() calls
Ran 41 tests across 9 files. [27.00ms]
```
(41 vs. the 39 reported at Task 3 landing — +2 from this review-fix's new tests; no other test count changed.)

**Typecheck** — `bun run typecheck`: clean (`tsc --noEmit`, no output).

**Lint** — `bun run lint:file -- "src/provisioning/fit.ts"`:
```
$ biome check src/provisioning/fit.ts
Checked 1 file in 28ms. No fixes applied.
```

**Files changed:** `src/provisioning/fit.ts` (+6 lines: guard call + `hasNoSizingSignal` helper),
`tests/provisioning/fit.test.ts` (+13 lines: 2 new tests). No other files touched — catalog sources and
snapshot untouched per instructions.

**Commit:** `19e7354` — `fix(provisioning): fitAndRank never recommends an unenriched 0/0 placeholder (Slice 14 Task 3 review)`.

**Concern carried forward:** this fix only stops *auto-recommendation* of phantom candidates; the underlying
placeholder (0/0 sizing) still flows through `fitAndRank`'s output for Ollama/HF discovery sources until
Task 4 wires real enrichment. Downstream consumers of the candidate list (UI, download selection) should not
treat "not recommended" as "safe to ignore silently" — a placeholder with no sizing signal is still
present and may need explicit handling until Task 4 lands.
