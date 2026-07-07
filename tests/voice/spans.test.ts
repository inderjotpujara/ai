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
