# Task 4 Report: `setup:voice` Model Downloader

## Status
✅ COMPLETE

## Implementation Summary

Implemented idempotent voice-model provisioning script (`scripts/setup-voice.ts`) following the `setup-media.ts` pattern. The script downloads the sherpa-onnx STT model (default: `moonshine-tiny-en-int8`) to the voice cache directory, checks readiness via `tokens.txt` marker, and gracefully degrades on network failure—never throwing, always logging.

### Pure Helpers (Unit-Tested)
- **`modelUrl(name): string`** — Builds `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/<name>.tar.bz2`
- **`isModelReady(dir, exists): boolean`** — Checks for `tokens.txt` marker with injectable `exists` fn (default `existsSync`); hermetic for testing

### Main Function (Exercised in Live-Verify)
- Ensures `ffmpeg` available (Homebrew on macOS, manual on other platforms)
- Skips download if model already ready
- Downloads via `curl` (gracefully logs and returns on failure)
- Extracts via `tar`
- Validates extraction, logs status

## TDD Execution

### RED → GREEN
1. **Step 1:** Wrote failing test (`tests/voice/setup-voice.test.ts`) — 2 test cases for `modelUrl` and `isModelReady`
2. **Step 2:** Verified FAIL (`"Cannot find module"`)
3. **Step 3:** Wrote minimal implementation
4. **Step 4:** Verified PASS (2/2 tests)
5. **Step 5:** Committed

## Files Changed

- **Created:** `scripts/setup-voice.ts` (95 lines, exportable pure helpers + main)
- **Created:** `tests/voice/setup-voice.test.ts` (16 lines, 2 test cases)
- **Modified:** `package.json` (added `"setup:voice": "bun run scripts/setup-voice.ts"` after `"setup:media"`)

## Git Commit

```
2abf804 feat(voice): setup:voice model downloader + ffmpeg check
```

## Test Summary

```
bun test v1.3.11 (af24e281)
 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [33.00ms]
```

All tests passing; typecheck clean.

## Concerns

None. Implementation mirrors `setup-media.ts` idioms exactly, exports are pure + injectable, main() has graceful degrade + never throws.

## Integration Readiness

- ✅ Imports `voiceCacheDir` + `DEFAULT_VOICE_MODEL` from Task 3 (`src/voice/model.ts`)
- ✅ Typecheck passes
- ✅ Tests pass (pure helpers only; main() exercise deferred to live-verify)
- ✅ Package script registered
- ⏳ Network download deferred to live-verify (not run locally)

## Post-Review Fix: Exit Code Checks (Commit b935268)

### Changes Applied
1. **tar extraction exit code (line 60–62):**
   - Capture `tarCode` from `run(['tar', '-xjf', archive, '-C', voiceCacheDir()])`
   - Check: if `tarCode !== 0`, log `'Extraction failed.'` and return
   - Preserves readiness check log for success path

2. **brew install exit code (line 40–42):**
   - Capture `brewCode` from `run(['brew', 'install', 'ffmpeg'])`
   - Check: if `brewCode !== 0`, log `'ffmpeg install failed — voice capture will be unavailable.'`
   - Graceful degrade: no throw, continue (ffmpeg availability only)

### Test Result
```bash
$ bun test tests/voice/setup-voice.test.ts
 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [32.00ms]
```
Pure helpers unchanged; all tests passing. Typecheck clean.

### Commit
```
b935268 fix(voice): check tar/brew exit codes in setup-voice
```
