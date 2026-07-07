import { describe, expect, it } from 'bun:test';
import { CaptureSource, VoiceError, VoiceOutcome } from '../../src/voice/types.ts';

describe('voice types', () => {
  it('VoiceError carries an actionable hint', () => {
    const e = new VoiceError('no audio', 'grant Microphone access');
    expect(e).toBeInstanceOf(Error);
    expect(e.hint).toBe('grant Microphone access');
    expect(e.name).toBe('VoiceError');
  });
  it('enums use explicit string values', () => {
    expect(CaptureSource.Mic).toBe('mic' as CaptureSource);
    expect(VoiceOutcome.Empty).toBe('empty' as VoiceOutcome);
  });
});
