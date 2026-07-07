# Task 6 report — runGenJob clears model on cross-engine degrade

## Status: DONE

## Commit
`d723c53` — fix(media): runGenJob drops engine-specific model repo when degrading to a fallback
Branch: `slice-28-hardware-adaptive-gen`

## What changed
- `src/media/generate/adapter.ts`, `runGenJob`:
  - one-shot-primary → server-fallback branch: `runServerJob(fallback, prompt, store, mediaType, opts, deps)` → `runServerJob(fallback, prompt, store, mediaType, { ...opts, model: undefined }, deps)`
  - server-primary → one-shot-fallback branch: `runOneShotJob(fallback, prompt, store, mediaType, opts, deps)` → `runOneShotJob(fallback, prompt, store, mediaType, { ...opts, model: undefined }, deps)`
  - Non-degrade paths (primary runs as-is) are untouched — `opts` still flows through unchanged.
- New test: `tests/media/gen-job-degrade-model.test.ts` — added verbatim per brief, with one required fix (see Deviation below).

## TDD sequence
1. Wrote the failing test verbatim from the brief.
2. Ran `bun run test:file -- "tests/media/gen-job-degrade-model.test.ts"` → FAIL as expected: `fallbackModel` was `'mlx/repo'` (opts.model leaked into fallback's `serverSubmit`).
3. Applied the two-line fix in `adapter.ts` (both fallback invocations spread `opts` with `model: undefined`).
4. Re-ran the same test → PASS.

## Deviation from brief (required for typecheck)
The brief's verbatim test code has `poll: async () => ({ fraction: 1 })` in the fallback's `serverSubmit` mock. `JobProgress` (src/media/types.ts) requires `message: string` (only `fraction` and `previewUri` are optional), so this literal fails `tsc --noEmit` with:
```
Property 'message' is missing in type '{ fraction: number; }' but required in type 'JobProgress'.
```
Fixed minimally by changing that line to `poll: async () => ({ fraction: 1, message: 'done' })`. No other code deviates from the brief. This is a test-only fix with no bearing on the behavior under test (the assertion is solely on `fallbackModel`).

## New test result
`bun run test:file -- "tests/media/gen-job-degrade-model.test.ts"` → 1 pass, 0 fail (asserts `fallbackModel` is `undefined` after a forced one-shot→server degrade with `opts.model: 'mlx/repo'`).

## Existing adapter/gen test regression check
Ran the following existing test files together with the new one:
- `tests/media/adapter-oneshot.test.ts`
- `tests/media/adapter-server.test.ts`
- `tests/media/gen-select.test.ts`
- `tests/media/generate-tools.test.ts`
- `tests/media/telemetry-generate.test.ts`

Command: `bun run test:file -- "tests/media/gen-job-degrade-model.test.ts" "tests/media/adapter-oneshot.test.ts" "tests/media/adapter-server.test.ts" "tests/media/gen-select.test.ts" "tests/media/generate-tools.test.ts" "tests/media/telemetry-generate.test.ts"`

Result: **31 pass, 0 fail, 73 expect() calls across 6 files.** No regressions — same-strategy (non-degrade) paths keep passing `opts` unchanged, confirming the fix is scoped to only the two fallback-invocation branches.

## Lint / typecheck
- `bun run lint:file --write -- "src/media/generate/adapter.ts" "tests/media/gen-job-degrade-model.test.ts"` → Biome checked 2 files, fixed 2 files (import-order/formatting only, no logic changes — reviewed the diff, confirmed cosmetic).
- `bun run typecheck` → clean, no errors (after the `message` fix above).

## Blocking concerns
None.

## Note
This report overwrites a stale `task-6-report.md` left over from a prior/different slice run (an unrelated LM Studio runtime-strategy task under the same filename). That content has been fully replaced with this task's report.
