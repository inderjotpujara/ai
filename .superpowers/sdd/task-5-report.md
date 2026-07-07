### Task 5 report: Telemetry — `voice.transcribe` span

**Status:** Done.

## Note on this file
This overwrites a stale `task-5-report.md` from an unrelated earlier slice's
task ("Wan checkpoint from opts.model" — Slice 28 media work), which had the
same filename due to per-slice task numbering restarting at 1. That content
is preserved in git history (previous commit touching this path) and in
`.superpowers/sdd/progress.md` if ledgered there.

## Implementation

Added `voice.transcribe` telemetry span + `VOICE_*` attributes to the shared
`src/telemetry/spans.ts` (~850-line file), mirroring the existing Slice-27
`withTranscribeSpan` pattern exactly.

### Exact insertion points

1. **`src/telemetry/spans.ts:13`** — new import (type-only, per biome
   `useImportType`):
   ```ts
   import type { CaptureSource } from '../voice/types.ts';
   ```
   Inserted alphabetically between `'../verified-build/types.ts'` and
   `'./provider.ts'`.

2. **`src/telemetry/spans.ts` — end of the frozen `ATTR` object**, right
   after `GEN_FIT_CANDIDATES: 'media.gen_fit.candidates',` and before the
   closing `} as const;`: added a new `// Voice input (Slice 29)` block with
   the 5 required keys:
   ```ts
   VOICE_STT_MODEL: 'voice.stt.model',
   VOICE_CAPTURE_SOURCE: 'voice.capture.source',
   VOICE_AUDIO_SECONDS: 'voice.audio.seconds',
   VOICE_DURATION_MS: 'voice.duration.ms',
   VOICE_OUTCOME: 'voice.outcome',
   ```

3. **`src/telemetry/spans.ts`, immediately before `export type
   FrameSampleSpanInfo = {`** (right after `withTranscribeSpan`'s closing
   brace): added `VoiceSpanInfo` type + the `withVoiceTranscribeSpan` helper,
   per the brief:
   ```ts
   export type VoiceSpanInfo = { model: string; source: CaptureSource };

   export function withVoiceTranscribeSpan<T>(
     info: VoiceSpanInfo,
     fn: (span: Span) => Promise<T>,
   ): Promise<T> {
     return inSpan('voice.transcribe', async (span) => {
       span.setAttribute(ATTR.VOICE_STT_MODEL, info.model);
       span.setAttribute(ATTR.VOICE_CAPTURE_SOURCE, info.source);
       span.setAttribute(ATTR.INPUT_MODALITY, 'audio');
       return fn(span);
     });
   }
   ```
   Added a docstring above it mirroring `withTranscribeSpan`'s comment style.
   `VOICE_AUDIO_SECONDS` / `VOICE_DURATION_MS` / `VOICE_OUTCOME` are defined
   in `ATTR` for downstream callers (Tasks 6-9: transcriber/capture wiring)
   to `span.setAttribute(...)` directly via the `fn(span)` callback once
   duration/outcome are known post-hoc — exactly the same pattern
   `withTranscribeSpan`'s callers use today for `MEDIA_TRANSCRIBE_*`.

### One deviation from the brief's literal snippet

The brief's Step 3 snippet used a plain
`import { CaptureSource } from '../voice/types.ts';`. Biome's
`lint/style/useImportType` flagged this as a warning because `CaptureSource`
is used only in a type position (`VoiceSpanInfo.source: CaptureSource`)
inside `spans.ts` — its runtime/enum side is never referenced there. Changed
to `import type { CaptureSource } from '../voice/types.ts';` to keep
`bun run lint:file` clean. No behavior change: `tests/voice/spans.test.ts`
still imports `CaptureSource` as a normal value import and uses
`CaptureSource.File` at runtime, unaffected by the type-only import in
`spans.ts`.

## TDD — RED → GREEN

- **RED:** Wrote `tests/voice/spans.test.ts` first (verbatim from brief).
  `bun test tests/voice/spans.test.ts` failed with:
  `SyntaxError: Export named 'withVoiceTranscribeSpan' not found in module
  '/Users/inderjotsingh/ai/src/telemetry/spans.ts'.`
- **GREEN:** After adding the ATTR keys + import + helper:
  `bun test tests/voice/spans.test.ts` → `2 pass, 0 fail, 4 expect() calls`.

## Typecheck — import-cycle gate

`bun run typecheck` (`tsc --noEmit`) ran clean with **zero errors** after the
change. Confirmed no import cycle: `src/voice/types.ts` imports nothing (it's
a leaf module — only defines `VoiceFrames`, `CaptureSource`, `VoiceOutcome`,
`VoiceError`, `VoiceConfig`, `Transcriber`), so `spans.ts` importing
`CaptureSource` from it is a one-directional edge with no path back to
`telemetry/`.

## Lint

`bun run lint:file -- "src/telemetry/spans.ts" "tests/voice/spans.test.ts"`
→ clean (`biome check`, 0 warnings/errors) after switching to `import type`.

## Files changed

- `src/telemetry/spans.ts` — added import, 5 `ATTR.VOICE_*` keys,
  `VoiceSpanInfo` type, `withVoiceTranscribeSpan` helper. No existing
  exports touched, removed, or reordered.
- `tests/voice/spans.test.ts` — new test file (verbatim from brief).

## Self-review

- Attribute key string values match the brief exactly (`voice.stt.model`,
  `voice.capture.source`, `voice.audio.seconds`, `voice.duration.ms`,
  `voice.outcome`).
- `withVoiceTranscribeSpan` opens span `'voice.transcribe'`, sets model +
  capture source + `ATTR.INPUT_MODALITY = 'audio'`, then runs `fn(span)` —
  matches the brief's Step 3 code exactly (only the import line differs, per
  the lint-driven deviation above).
- Did not touch `withTranscribeSpan` or any other existing helper/export;
  `ATTR` object remains frozen (`as const`).
- New `ATTR` keys placed in a clearly labeled `// Voice input (Slice 29)`
  section, consistent with the existing `// Multimodal analysis (Slice 27)` /
  `// Runtime warm/spawn (Slice 26)` sectioning convention.
- No `console.log` left in; no `any` introduced.

## Concerns

None blocking. The import-cycle risk called out in the task instructions was
verified clean (`src/voice/types.ts` has zero imports). This is a pure
additive telemetry change with no runtime wiring yet — Tasks 6-9 will call
`withVoiceTranscribeSpan` from the actual transcriber/capture code and set
the remaining `VOICE_AUDIO_SECONDS`/`VOICE_DURATION_MS`/`VOICE_OUTCOME`
attributes via the span passed into `fn`.

## Commit
- See commit list in the final response; files staged were exactly
  `src/telemetry/spans.ts` and `tests/voice/spans.test.ts`.
