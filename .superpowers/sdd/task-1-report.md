# Task 1 report — gen candidate catalog

## Status: DONE

## What was done

Followed the brief at `.superpowers/sdd/task-1-brief.md` verbatim, TDD-style:

1. **Verified prerequisite imports exist** before writing anything:
   - `MediaKind` (values `image`/`audio`/`video`) and `ExecMode` (values `one_shot`/`server`) in `src/media/types.ts`.
   - `MediaVenv` (values `media`/`video`) in `src/media/cmd-resolve.ts`.
   - `ContentPolicy` in `src/core/types.ts`.
   All matched the brief's usage exactly — no adjustments needed.

2. **Step 1 — wrote the failing test** at `tests/media/gen-catalog.test.ts` (verbatim from the brief): 4 tests covering (a) all three `MediaKind`s present, (b) every candidate well-formed (non-empty repo/label, positive footprint numbers, engine is a valid `GenEngine`), (c) video ladder spans both `MlxVideo` and `ComfyWan` engines, (d) image anchor is the ungated pre-quantized FLUX mirror (`dhairyashil/FLUX.1-schnell-mflux-4bit`).

3. **Step 2 — ran the test, confirmed it failed** as expected:
   ```
   error: Cannot find module '../../src/media/generate/catalog.ts' from '/Users/inderjotsingh/ai/tests/media/gen-catalog.test.ts'
   0 pass / 1 fail / 1 error
   ```

4. **Step 3 — wrote the implementation** at `src/media/generate/catalog.ts` (verbatim from the brief):
   - `GenEngine` string enum: `Mflux = 'mflux'`, `MlxAudio = 'mlx-audio'`, `MlxVideo = 'mlx-video'`, `ComfyWan = 'comfy-wan'`.
   - `GenModelCandidate` type: `{ kind, repo, engine, venv, execMode, footprint: { approxParamsBillions, bytesPerWeight }, contentPolicy?, label }`.
   - `GEN_CATALOG` array with 7 seeded candidates:
     - Image: FLUX.1-schnell mflux 4bit (anchor, ungated) + 8bit — both `Mflux` engine, `Media` venv, `OneShot`.
     - Audio: Kokoro-82M (mlx-audio, filter-free/no-cloning) + Sesame CSM-1B (voice clone) — both `MlxAudio` engine, `Media` venv, `OneShot`.
     - Video: LTX-Video 0.9.6 distilled GGUF (`ComfyWan`/`Video` venv/`Server`), LTX-2.3 int4 (`MlxVideo`/`Video` venv/`OneShot`), Wan2.2 TI2V-5B GGUF (`ComfyWan`/`Video` venv/`Server`) — spans both video engines as required.

5. **Step 4 — ran the test, confirmed pass:**
   ```
   $ bun test tests/media/gen-catalog.test.ts
   4 pass / 0 fail / 41 expect() calls
   Ran 4 tests across 1 file. [19.00ms]
   ```

6. **Step 5 — typecheck + commit:**
   ```
   $ tsc --noEmit
   (clean, no output)
   ```
   Committed on branch `slice-28-hardware-adaptive-gen`:
   ```
   commit 0bab116
   feat(media): gen model candidate catalog (image/speech/video ladders)
   2 files changed, 138 insertions(+)
   create mode 100644 src/media/generate/catalog.ts
   create mode 100644 tests/media/gen-catalog.test.ts
   ```
   The pre-commit `docs:check` hook ran and passed (`✔ docs-check: living docs present + linked; every src subsystem documented.`) — no docs update was needed for this task since it's an internal addition inside the already-documented `src/media` subsystem, not a new top-level subsystem.

## Files touched
- Created: `/Users/inderjotsingh/ai/src/media/generate/catalog.ts`
- Created: `/Users/inderjotsingh/ai/tests/media/gen-catalog.test.ts`

## Deviations from the brief
None. Code and test are verbatim per the brief's Step 1 and Step 3 blocks.

## Concerns
None blocking. Two minor observations for the fit-selector task that consumes this catalog (not this task's scope, just noting for continuity):
- `contentPolicy` is optional and unset on every seeded candidate here — presumably a later task or the fit-selector defaults it, or it's intentionally left for models that need gating (e.g. voice cloning) to be filled in a follow-up.
- This is a plain data catalog with no validation logic beyond what the test checks (positive footprint, non-empty strings) — as intended, since ranking/fit logic is explicitly a later task per the brief's framing ("that a later fit-selector will rank").

## Note
This report file previously contained a stale report from Slice 26 Task 1 (RuntimeKind.LlamaCpp work). It has been overwritten with this task's (Slice 28 Task 1) report above.
