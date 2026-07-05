# Task 9 report: gated live-verify for LM Studio + llama.cpp download adapters

Note: this filename was previously reused for an earlier, unrelated Task 9
(Slice 21 reliability telemetry / ATTR keys + recordDegrade). That content is
superseded here — this is the Slice 26 altruntime-download live-verify task.

## Status: DONE

## What was done

Created `tests/integration/altruntime-download.live.test.ts`, gated behind
`ALTRUNTIME_LIVE=1` (mirrors the `LIVE` const + `describe.skipIf(!LIVE)` idiom
used in `tests/integration/reliability-live.test.ts` and
`tests/integration/mlx.live.test.ts`).

Two tests inside the gated `describe`:

1. **LM Studio** — calls `createLmStudioProvider()` (no deps, so it hits the
   real LM Studio REST API at `http://localhost:1234`) and downloads a
   placeholder tiny model (`lmstudio-community/tinyllama-1.1b-chat-v1.0`),
   asserting the last emitted progress phase is `DownloadPhase.Done`. Shape
   (`download(modelRef, { onProgress, signal, destDir })`) matches
   `tests/provisioning/lmstudio.test.ts` and `src/provisioning/providers/lmstudio.ts`.
2. **llama.cpp / HfGguf** — calls `createHfFetchProvider(ProviderKind.HfGguf)`
   (no deps, so it uses the real `fetch` and the real `hfTreeFiles` from
   `src/provisioning/catalog/hf-catalog.ts`) to fetch a placeholder GGUF file
   ref (`TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF::tinyllama-1.1b-chat-v1.0.Q2_K.gguf`)
   into an `mkdtempSync` temp dir, then asserts the resulting file exists and
   has non-zero size via `statSync(...).size`. The output path is computed
   the same way `HfGguf` writes it in `src/provisioning/providers/hf-fetch.ts`
   (`join(destDir, file)`, no repo subdirectory — confirmed against the
   `HfGguf` cases in `tests/provisioning/hf-fetch.test.ts`).

Both tests use a 300_000ms (5 min) timeout, and both model refs are commented
as placeholders to be confirmed/swapped for genuinely tiny, license-clear
models when Task 17 wires up the real runtimes and flips `ALTRUNTIME_LIVE=1`.

## Verification performed

- `bun test tests/integration/altruntime-download.live.test.ts` (no env flag)
  → `0 pass, 2 skip, 0 fail` — the gate works correctly with no live runtimes
  present in this environment.
- `bun run typecheck` → clean.
- `bun run lint:file tests/integration/altruntime-download.live.test.ts` →
  clean (biome check, no fixes needed).

## Self-review

- Imports all resolve: `ProviderKind` from `src/core/types.ts`,
  `createHfFetchProvider` from `src/provisioning/providers/hf-fetch.ts`,
  `createLmStudioProvider` from `src/provisioning/providers/lmstudio.ts`,
  `DownloadPhase` from `src/provisioning/types.ts` — all verified to exist
  with matching signatures by reading the source files directly.
- Gating idiom matches the two existing live-test files exactly (module-level
  `LIVE` const from `process.env`, `describe.skipIf(!LIVE)`).
- Provider call shapes were checked against both the provider source and
  their existing unit tests (`tests/provisioning/lmstudio.test.ts`,
  `tests/provisioning/hf-fetch.test.ts`) to make sure the live call is
  correctly shaped (arg order, options object keys, HfGguf's flat
  `destDir/file` output path vs. HfSnapshot's nested `destDir/repo/path`).
- No mocks/deps are passed to either provider constructor in the live test,
  so when `ALTRUNTIME_LIVE=1` is set in Task 17 these will exercise the real
  network paths, not test doubles.

## Commit

- `0597c79` — `test(runtime): gated live-verify for LM Studio + llama.cpp download adapters`
  (only the new test file staged/committed; other pending repo changes from
  parallel task work were left untouched).

## Concerns / follow-ups for Task 17

- Model ids (`LMSTUDIO_TINY_MODEL`, `HF_GGUF_MODEL_REF`) are unverified
  placeholders — Task 17 must confirm they resolve to real, small,
  license-clear artifacts (or swap them) before running live.
- LM Studio test assumes a daemon already running on `localhost:1234` with
  the REST download API enabled; no daemon-availability pre-check is done
  here (deliberately out of scope per the brief — Task 17 owns the live pass).
