### Task 5: Telemetry — `voice.transcribe` span

**Files:**
- Modify: `src/telemetry/spans.ts` (add `VOICE_*` attrs near the Slice-27 block ~line 119-135; add `withVoiceTranscribeSpan` near `withTranscribeSpan` ~line 773)
- Test: `tests/voice/spans.test.ts`

**Interfaces:**
- Consumes: `CaptureSource`, `VoiceOutcome` (Task 2).
- Produces: `withVoiceTranscribeSpan(info, fn)` where `info: { model: string; source: CaptureSource }`; sets outcome/duration on the span at settle.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/spans.test.ts
import { describe, expect, it } from 'bun:test';
import { ATTR, withVoiceTranscribeSpan } from '../../src/telemetry/spans.ts';
import { CaptureSource } from '../../src/voice/types.ts';

describe('withVoiceTranscribeSpan', () => {
  it('exposes VOICE_* attribute keys', () => {
    expect(ATTR.VOICE_STT_MODEL).toBe('voice.stt.model');
    expect(ATTR.VOICE_CAPTURE_SOURCE).toBe('voice.capture.source');
    expect(ATTR.VOICE_OUTCOME).toBe('voice.outcome');
  });
  it('runs the fn and returns its value', async () => {
    const out = await withVoiceTranscribeSpan(
      { model: 'tiny', source: CaptureSource.File },
      async () => 'hi',
    );
    expect(out).toBe('hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/spans.test.ts`
Expected: FAIL — `ATTR.VOICE_STT_MODEL` undefined / `withVoiceTranscribeSpan` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/telemetry/spans.ts`, add to the frozen `ATTR` object (near the multimodal block):
```ts
  VOICE_STT_MODEL: 'voice.stt.model',
  VOICE_CAPTURE_SOURCE: 'voice.capture.source',
  VOICE_AUDIO_SECONDS: 'voice.audio.seconds',
  VOICE_DURATION_MS: 'voice.duration.ms',
  VOICE_OUTCOME: 'voice.outcome',
```

Then add the helper (mirroring `withTranscribeSpan`), importing `CaptureSource` at top:
```ts
import { CaptureSource } from '../voice/types.ts';

export type VoiceSpanInfo = { model: string; source: CaptureSource };

/** Wraps a voice transcription in a `voice.transcribe` span. */
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

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/spans.test.ts`
Expected: PASS (2 tests). Also run `bun run typecheck` (the new import must not create a cycle — `types.ts` imports nothing from telemetry, so it's safe).

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/spans.ts tests/voice/spans.test.ts
git commit -m "feat(voice): voice.transcribe span + VOICE_* attributes"
```

---

