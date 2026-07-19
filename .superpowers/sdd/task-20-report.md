# Task 20 report: `src/telemetry/spans.ts` — `voice.transcribe.web` span writer (D10)

## Summary
Implemented `recordVoiceTranscribeWeb()` in `src/telemetry/spans.ts`, a fire-and-forget
OTel span writer (mirroring `recordChatFeedback`) that opens a new `voice.transcribe.web`
root span carrying the browser voice-input beacon's fields. Added three new `ATTR` keys
(`VOICE_WORD_COUNT`, `VOICE_REAL_TIME_FACTOR`, `VOICE_ENGINE`) immediately after
`VOICE_OUTCOME`. Left the pre-existing CLI-side `withVoiceTranscribeSpan` (`voice.transcribe`
span) untouched per D10 — this is a distinct span, not a repurpose.

## TDD flow followed
1. Wrote `tests/telemetry/voice-transcribe-web-span.test.ts` verbatim per the brief.
2. Ran it — failed as expected (`recordVoiceTranscribeWeb` not exported; `SyntaxError` at
   module load since the export didn't exist).
3. Added the 3 `ATTR.*` keys and the `recordVoiceTranscribeWeb` function verbatim per the
   brief, placed right after `withVoiceTranscribeSpan` (~line 1059).
4. Re-ran — 2 pass / 0 fail / 10 expect() calls.
5. Ran full `tests/telemetry/` suite — 48 pass / 0 fail (no regressions).
6. `bun run typecheck` — clean. `bun run lint:file` (biome check) on both changed files —
   clean, no fixes needed. `bunx biome check --write` on both files — clean, no changes.
7. Committed.

## Files changed
- `/Users/inderjotsingh/ai/src/telemetry/spans.ts` — added `VOICE_WORD_COUNT`,
  `VOICE_REAL_TIME_FACTOR`, `VOICE_ENGINE` to `ATTR`; added `recordVoiceTranscribeWeb()`
  export after `withVoiceTranscribeSpan`.
- `/Users/inderjotsingh/ai/tests/telemetry/voice-transcribe-web-span.test.ts` — new test
  file (verbatim per brief), using `registerTestProvider()` in-memory OTel harness.

## Commit
`09cec0c feat(telemetry): voice.transcribe.web span writer + VOICE_* attrs (D10)`
(branch `slice-30b-phase8-polish-a11y`). Only the two task-relevant files were staged;
other working-tree modifications present at task start (unrelated `.superpowers/sdd/*`
files from parallel task execution, `.remember/now.md`) were left untouched.

## Gate results
- `bun test tests/telemetry/voice-transcribe-web-span.test.ts` — 2 pass, 0 fail, 10 assertions.
- `bun test tests/telemetry/` (full suite) — 48 pass, 0 fail, 152 assertions.
- `bun run typecheck` — clean.
- `bun run lint:file -- "src/telemetry/spans.ts" "tests/telemetry/voice-transcribe-web-span.test.ts"` — clean.
- `bunx biome check --write` on both files — clean, no fixes applied.
- Pre-commit hook (`docs-check`) passed automatically on commit.

## Concerns
None. Implementation matches the brief verbatim; no ambiguity encountered. Task 21
(`POST /api/telemetry`) can now import `recordVoiceTranscribeWeb` from
`src/telemetry/spans.ts`.
