# Task 3 Report: Model + Tool Resolution (Slice 29)

## Status: DONE

## Commit
- `3625cf4` — feat(voice): model + ffmpeg resolution with env overrides
- Branch: `slice-29-voice-input-stt`

## Implementation Summary

Implemented `src/voice/model.ts` with three pure resolver functions following the injectable `env` pattern from `src/media/cmd-resolve.ts`:

- **`voiceCacheDir(env?)`** — Returns voice model cache directory, defaulting to `~/.cache/ai/voice`; `AGENT_VOICE_DIR` overrides.
- **`resolveVoiceModel(env?)`** — Returns resolved model path with precedence: explicit `AGENT_VOICE_STT_MODEL` (absolute) > `<cacheDir>/sherpa-onnx-moonshine-tiny-en-int8`.
- **`ffmpegCmd(env?)`** — Returns ffmpeg command, defaulting to bare `ffmpeg`; `AGENT_FFMPEG_CMD` overrides.
- **`DEFAULT_VOICE_MODEL`** — Constant export: `'sherpa-onnx-moonshine-tiny-en-int8'`.

All functions accept an injectable `Env` parameter (defaults to `process.env`) for test hermeticity.

## TDD Cycle

**RED** (step 2):
```
error: Cannot find module '../../src/voice/model.ts'
```

**GREEN** (step 4):
```
5 pass
0 fail
6 expect() calls
Ran 5 tests across 1 file. [13.00ms]
```

All 5 tests pass; typecheck clean.

## Files Changed

1. **`tests/voice/model.test.ts`** — NEW, 28 lines. Five test cases:
   - Cache dir defaults under `~/.cache/ai/voice`
   - `AGENT_VOICE_DIR` env override
   - Model name joined under cache dir
   - `AGENT_VOICE_STT_MODEL` absolute override
   - `ffmpegCmd` precedence chain

2. **`src/voice/model.ts`** — NEW, 26 lines. Three resolver functions + constant.

## Self-Review

✅ **Compliance:**
- Follows TDD (red test first, green implementation, typecheck pass).
- Matches task brief exactly (steps 1–5, code verbatim).
- Env injection pattern consistent with `src/media/cmd-resolve.ts`.
- All env precedence rules correctly implemented.
- Commits with required trailer.

✅ **Quality:**
- 5/5 tests passing; no flake.
- Typecheck: zero errors.
- Function signatures match brief.
- Default model name matches Slice 29 spec (Moonshine, not full Sherpa-ONNX).
- Hermetic test env injection (no global state pollution).

✅ **Integration:**
- Pre-commit hook ran: `bun run docs-check.ts` passed (no undocumented subsystems).
- Ready for downstream tasks (T4: `scripts/setup-voice.ts` can consume these resolvers).

## Blocking Concerns

None. The module is minimal, pure, and testable. Ready to hand off to Task 4.
