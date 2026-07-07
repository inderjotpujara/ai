# Task 4 Report — Video model plumb (LTX `--model` from opts.model)

## Status: DONE

## What was done
Followed the brief exactly (TDD), using the verbatim code provided.

1. **Step 1 — failing test written**: `tests/media/video-model-plumb.test.ts` created verbatim from the brief — two tests: one asserting `--model <repo>` appears in `args` when `opts.model` is set, one asserting `--model` is absent when `opts.model` is unset.
2. **Step 2 — confirmed red**: `bun run test:file -- "tests/media/video-model-plumb.test.ts"` → 1 pass / 1 fail (the "emits --model" test failed with `indexOf('--model')` returning `-1`), matching the brief's expected failure mode.
3. **Step 3 — implementation**: In `src/media/generate/video-mlx.ts`:
   - Added `...(opts.model ? ['--model', opts.model] : [])` to the `args` array in `ltxStrategy.buildOneShot`, placed immediately after `'--prompt', prompt,` and before `'--pipeline', pipeline,` — mirrors the existing `opts.image` conditional spread pattern already in the file.
   - Updated the doc-comment above `ltxStrategy` to add: `- model: opts.model adds --model <repo> (from the gen-fit selector); omitted → the mlx-video default repo.`
4. **Step 4 — confirmed green**: `bun run test:file -- "tests/media/video-model-plumb.test.ts"` → 2 pass / 0 fail.
5. **Step 5 — lint, typecheck, commit**:
   - `bun run lint:file --write -- "src/media/generate/video-mlx.ts" "tests/media/video-model-plumb.test.ts"` → exit 0. Emitted 2 *warnings* (not errors) about `noNonNullAssertion` on `ltxStrategy.buildOneShot!(...)` in the test file — the `!` non-null assertion is verbatim from the brief's Step 1 code, so left as-is per "use it verbatim; do not add scope"; these did not block lint (exit 0, no fixes applied since they're unsafe auto-fixes).
   - `bun run typecheck` → clean (`tsc --noEmit`, no output/errors).
   - Committed both files together; pre-commit hook (`bun run scripts/docs-check.ts`) passed — no doc surface needed touching for this task (behavior-only change to an already-documented strategy).

## Commit
- SHA: `9c2e758` on branch `slice-28-hardware-adaptive-gen`
- Message: `feat(media): ltxStrategy emits --model from opts.model (gen-fit injection)`
- Files: `src/media/generate/video-mlx.ts`, `tests/media/video-model-plumb.test.ts` (2 files changed, 21 insertions)

## Test summary
2/2 new tests pass (`tests/media/video-model-plumb.test.ts`); no other test files touched or run in this task.

## Lint/typecheck result
Lint: exit 0, 2 non-blocking warnings (pre-existing verbatim-brief pattern, non-null assertion in test). Typecheck: clean.

## Blocking concerns
None. Behavior preserved when `opts.model` is unset (baked-repo default), and `--model <repo>` is emitted right after `--prompt` when set, matching the brief's exact flag placement and mirroring the `opts.image` pattern already used in this file. Per the brief, the exact flag name (`--model`) still needs live-verification against the real mlx-video CLI (same caveat the brief calls out, analogous to the earlier `--num-frames` fix) — that is out of scope for this unit-test-level task and is presumably covered by the slice's live-verify step.

## Note on this file
This report file previously contained a stale report from an unrelated task (llama.cpp inference-runtime strategy, commit `407c2bf`) that reused the `task-4-report.md` filename in a prior run/session. That content has been replaced above with this task's actual report. If the llama.cpp report is still needed for record-keeping, retrieve it from commit `407c2bf`'s associated history rather than this file.
