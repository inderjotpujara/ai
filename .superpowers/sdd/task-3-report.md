# Task 3 Report: `AGENT_WEB_VOICE_*` config entries + `renderIndexHtml` window globals (Phase 7)

## Status: DONE

## Reconciliation
The brief's exact file locations, line numbers, signatures, and call site all matched the real code — no deviations were needed. Implemented verbatim per the brief.

## What was implemented
- `src/config/schema.ts`: appended two `CONFIG_SPEC` entries immediately after `AGENT_WEB_NOTIFY_MIN_DURATION_MS` (same zod-style/doc-comment convention):
  - `AGENT_WEB_VOICE_DEFAULT_MODEL` (string, default `'moonshine-base'`)
  - `AGENT_WEB_VOICE_VAD_SILENCE_MS` (number, default `800`)
- `src/server/main.ts`:
  - Added `VoiceWindowConfig` type + `DEFAULT_VOICE_CONFIG` next to `NotifyConfig`/`DEFAULT_NOTIFY_CONFIG`.
  - `renderIndexHtml` gained a 4th param `voice: VoiceWindowConfig = DEFAULT_VOICE_CONFIG`; `tokenScript` now also injects `window.__AGENT_VOICE_DEFAULT_MODEL__` and `window.__AGENT_VOICE_VAD_SILENCE_MS__`, using the same `JSON.stringify` + `<`→`<` escaping already applied to the token.
  - `startWebServer`'s `renderIndexHtml(...)` call site threads `cfg.AGENT_WEB_VOICE_DEFAULT_MODEL` / `cfg.AGENT_WEB_VOICE_VAD_SILENCE_MS` through as the 4th arg.
- `tests/config/schema.test.ts`: appended the 2 tests from the brief verbatim.
- `tests/server/main.test.ts`: appended the 2 tests from the brief verbatim (Biome auto-reformatted one `toContain(...)` call's line-wrap for length; no behavior change).

## TDD evidence
**RED** (`bun test tests/config/schema.test.ts tests/server/main.test.ts`, before implementation): 4 new tests failed — `values.AGENT_WEB_VOICE_DEFAULT_MODEL`/`AGENT_WEB_VOICE_VAD_SILENCE_MS` were `undefined`; the two `renderIndexHtml` voice-injection assertions failed (globals absent from rendered HTML). 15 pass / 4 fail overall.

**GREEN** (same command, after implementation): 19 pass / 0 fail, 190 expect() calls — includes all pre-existing notify-config tests, unaffected.

## Gate (all three, before commit)
- `bun run typecheck` — clean.
- `bun run lint:file -- src/config/schema.ts src/server/main.ts tests/config/schema.test.ts tests/server/main.test.ts` — one auto-fix applied (`--write`) to a test line-wrap in `tests/server/main.test.ts`; re-ran, clean.
- Focused tests: `bun test tests/config/schema.test.ts tests/server/main.test.ts` — 19 pass, 0 fail (190 expect calls).

## Files changed
- `src/config/schema.ts` (+2 `CONFIG_SPEC` entries)
- `src/server/main.ts` (`VoiceWindowConfig`/`DEFAULT_VOICE_CONFIG`, `renderIndexHtml` 4th param + injection, `startWebServer` call site)
- `tests/config/schema.test.ts` (+2 tests)
- `tests/server/main.test.ts` (+2 tests)

## Commit
`d891e93 feat(voice): add AGENT_WEB_VOICE_* config + renderIndexHtml window globals (D7)` — 4 files changed, 64 insertions(+), 5 deletions(-).

Pre-commit hook (`docs-check`) passed: "living docs present + linked; every src subsystem documented." This is an in-progress slice commit (not a landing), so `docs/architecture.md` was intentionally not touched — no push was performed. Only the four intended files were staged/committed (verified via `git status --short` before commit).

## Self-review
- New config entries mirror the `AGENT_WEB_NOTIFY_*` precedent exactly in shape and doc-comment style, including forward-references to the not-yet-built consumers (`web/src/features/voice/stt-engine.ts`, `web/src/features/voice/vad.ts`) — consistent with how the notify entries referenced `use-run-notifications.ts` ahead of that consumer landing.
- `renderIndexHtml`'s new 4th parameter is additive and defaulted, so all existing call sites and tests (including the 2-arg and 3-arg forms) continue to work unchanged — verified by the full focused-test run showing pre-existing notify tests still green.
- Token/global escaping mechanism was reused verbatim (`JSON.stringify(...)`) rather than re-implemented, keeping the hostile-token XSS-escaping test's coverage intact for the new globals' code path (same `tokenScript` string-builder, same escape applied only to `token` — appropriate since the two new values are server-controlled config, not user input).

## Concerns
None. Scope was exactly the two config knobs + the one `renderIndexHtml` extension point specified in the brief; no scope creep.
