# Task 7 report — wire selector + runGenJob into createGenerateTools

## Status: DONE

Commit: `eec4a76` on branch `slice-28-hardware-adaptive-gen`
("feat(media): wire gen-fit selector + runGenJob into createGenerateTools")

## What changed

`src/media/generate/tools.ts` rewritten verbatim per the brief:
- Added `STRATEGY_FOR_ENGINE: Record<GenEngine, GenStrategy>` map.
- Added `videoFallbackFor` (picks the other video engine's strategy) and
  `_comfyReachable` (async ComfyUI probe, kept for the live-verify task —
  see lint note below).
- `createGenerateTools` gained a `deps.selectModel` test seam (defaults to
  the real `selectGenModel`). Each of `generate_image`/`generate_speech`/
  `generate_video` now: (a) calls `select(kind)` to fit-select a
  `GenModelCandidate`, returning a graceful "No <kind>-generation model
  fits this machine..." message when `undefined`; (b) resolves
  `STRATEGY_FOR_ENGINE[candidate.engine]` and runs via `runGenJob` (not
  `runOneShotJob`) with `opts.model = candidate.repo`; (c) `generate_video`
  additionally passes `fallback: videoFallbackFor(strategy)` and a
  synchronous `serverReachable: () => true` into `runGenJob`'s deps, per
  the brief's documented limitation that a real async ComfyUI probe can't
  be awaited inside `runGenJob`'s synchronous `serverReachable` callback
  this slice.

One deliberate deviation from the brief's literal text (not scope, just
lint-cleanliness): the brief's sample named the probe `comfyReachable`
(unused, since `serverReachable` stays synchronous this slice). Biome's
`noUnusedVariables` flagged it, so I renamed it to `_comfyReachable`
(Biome's own suggested-fix convention for "intentionally unused, kept for
later") rather than deleting it or leaving lint dirty.

## Existing test regression — `tests/media/generate-tools.test.ts`

**Why it needed updating:** the tools now call `select(kind)` (real
`selectGenModel` by default) before running anything. On this dev
machine, image (`FLUX.1-schnell-mflux-4bit`) and audio
(`Kokoro-82M-bf16`) models are already downloaded to the HF cache
(confirmed via `~/.cache/huggingface/hub`), so those two tests happened
to still pass against the *real* selector by coincidence. The video test
failed outright: no video model is installed locally (video is the
"higher-disk-box" capability per prior slice notes), so real
`selectGenModel` legitimately returned `undefined` and the tool returned
the new graceful no-fit message instead of running the mocked spawn —
breaking the `.toMatch(/\.mp4$/)` assertion. This is exactly the failure
mode the task brief predicted.

**What I changed:**
- Added a `fakeCandidate(kind, engine)` helper building a minimal
  `GenModelCandidate` fixture (fake repo, `MediaVenv.Media`,
  `ExecMode.OneShot`, a nominal footprint) so tests don't depend on live
  hardware/installed-model state.
- Every test that exercises a real generation now passes
  `selectModel: async () => fakeCandidate(...)` with the engine matching
  the mocked spawn's expected CLI flags (`GenEngine.Mflux` for the image
  tests expecting `--output`; `GenEngine.MlxAudio` for the speech test
  expecting `--file_prefix`; `GenEngine.MlxVideo` for the video test
  expecting `--output-path`).
- The video test additionally passes `which: () => '/fake/bin/mlx_video'`
  (cast via `as never`, matching this file's existing `{} as never`
  idiom for bypassing the narrower public `deps` type) — without it,
  `runGenJob`'s real `Bun.which(cmd)` check finds the LTX binary genuinely
  absent from PATH in this environment and degrades to the
  `wanComfyStrategy` server fallback (a real `fetch` to ComfyUI), which
  isn't what this test is exercising and would hang/fail. Forcing `which`
  to report "found" keeps the test on the one-shot lane with the mocked
  `spawn`, exactly like before.
- No assertions were weakened — same `.toMatch(/\.(png|wav|mp4)$/)` /
  `not.toBeInstanceOf(Uint8Array)` / `toContain('Generated image:')`
  checks as before, now reached via the new selector seam instead of by
  coincidence of what happens to be installed on this machine.

Also cleaned up one lint warning in the new `gen-tools-wiring.test.ts`:
the brief's sample used `(tools.generate_image as any).execute(...)`,
which Biome's `noExplicitAny` flags. Replaced with the same
`tools.generate_image?.execute?.({ prompt: 'x' }, {} as never)` pattern
already used throughout `generate-tools.test.ts` (identical runtime
behavior, no `any`).

## Tests run (all pass)

- `bun run test:file -- "tests/media/gen-tools-wiring.test.ts"` — 1 pass
  (new no-fit-degrade test).
- `bun run test:file -- "tests/media/generate-tools.test.ts" "tests/media/telemetry-generate.test.ts"` — 10 pass, 0 fail (telemetry file untouched — it calls `runOneShotJob` directly, never through `createGenerateTools`, so unaffected).
- `bun run test:file -- "tests/media/adapter-oneshot.test.ts" "tests/media/adapter-server.test.ts"` — 15 pass, 0 fail.
- `bun test tests/media/` (full media suite, broader sweep) — 134 pass, 0 fail across 34 files.
- `bun run typecheck` — clean (`tsc --noEmit`, no output).
- `bun run lint:file --write -- "src/media/generate/tools.ts" "tests/media/gen-tools-wiring.test.ts" "tests/media/generate-tools.test.ts"` — clean after the two fixes above: 0 warnings, 0 errors, exit 0.

## Files touched
- `/Users/inderjotsingh/ai/src/media/generate/tools.ts` (rewritten per brief, +76/-24 net)
- `/Users/inderjotsingh/ai/tests/media/generate-tools.test.ts` (updated to the `selectModel`/`which` seam)
- `/Users/inderjotsingh/ai/tests/media/gen-tools-wiring.test.ts` (new)

## Blocking concerns

None. Pre-commit `docs:check` hook passed (no `docs/architecture.md`
update required — this task wires existing pieces together, no new
subsystem/module boundary).

## Fix commit — review findings A + B

Two review findings landed as a fix commit on top of `eec4a76`.

**Fix A [Important] — env-pin picked the FIRST catalog entry of a kind,
not the one matching the pinned repo's engine.** `src/media/generate/select.ts`'s
env-pin branch built its synthetic candidate from
`catalog.find((c) => c.kind === kind)`. Video has two engines in
`GEN_CATALOG` (`GenEngine.ComfyWan`/`ExecMode.Server` listed first, then
`GenEngine.MlxVideo`/`ExecMode.OneShot`), so pinning `AGENT_VIDEO_MODEL`
to the mlx-video repo silently inherited ComfyWan/Server and dispatched
to the wrong strategy. Fixed the base-entry lookup to a priority chain:
(1) exact `repo === pinned` match, (2) the kind's default one-shot entry
(`c.execMode === ExecMode.OneShot`), (3) any entry of that kind, (4) the
pre-existing hardcoded enum fallback. Everything else about the env-pin
branch (synchronous return, `recordGenFit({fits:true})`, `repo`/`label`
override) is unchanged.

**Fix B [Minor] — dead code.** Deleted the unreferenced `_comfyReachable`
async stub from `src/media/generate/tools.ts` (YAGNI; re-add when the
real async probe lands). Left `generate_video`'s synchronous
`serverReachable: () => true` wiring untouched — that's a disclosed
follow-on, not part of this fix.

**Tests added** to `tests/media/gen-select.test.ts` (both reproduce the
bug against a small fake video catalog with the ComfyWan/server entry
listed before the MlxVideo/one-shot entry, matching the real
`GEN_CATALOG` ordering):
- Pin `AGENT_VIDEO_MODEL` to the real `dgrauet/ltx-2.3-mlx-q4` repo →
  asserts `chosen?.engine === GenEngine.MlxVideo` and
  `chosen?.execMode === ExecMode.OneShot` (previously would have been
  `GenEngine.ComfyWan`/`ExecMode.Server`).
- Pin `AGENT_VIDEO_MODEL` to an unknown repo not in the catalog →
  asserts `chosen?.execMode === ExecMode.OneShot` (falls to the kind's
  one-shot default, not the first ComfyWan entry).

### Verification

- `bun run test:file -- "tests/media/gen-select.test.ts" "tests/media/gen-tools-wiring.test.ts" "tests/media/generate-tools.test.ts"` — 13 pass, 0 fail across 3 files, 19 `expect()` calls (11 pre-existing + 2 new).
- `bun run lint:file --write -- "src/media/generate/select.ts" "src/media/generate/tools.ts" "tests/media/gen-select.test.ts"` — clean; Biome auto-fixed one quote-escaping style nit in the new test (double→single-quote string, no semantic change).
- `bun run typecheck` — clean (`tsc --noEmit`, no output).

### Files touched
- `/Users/inderjotsingh/ai/src/media/generate/select.ts` (env-pin base-entry priority chain)
- `/Users/inderjotsingh/ai/src/media/generate/tools.ts` (`_comfyReachable` deleted)
- `/Users/inderjotsingh/ai/tests/media/gen-select.test.ts` (+2 tests)
