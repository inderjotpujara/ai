import { describe, expect, it } from 'bun:test';
import { createInProcessTranscriber } from '../../src/voice/transcribe.ts';
import { CaptureSource } from '../../src/voice/types.ts';

function fakeSherpa(text: string) {
  return () => ({
    OfflineRecognizer: class {
      createStream() {
        return { free() {} };
      }
      acceptWaveform() {}
      decode() {}
      getResult() {
        return { text };
      }
    },
  });
}

const cfg = { modelDir: '/m', ffmpeg: 'ffmpeg', timeoutMs: 5000 };

describe('createInProcessTranscriber', () => {
  it('returns recognized text for a buffer', async () => {
    const t = createInProcessTranscriber(cfg, {
      loadSherpa: fakeSherpa('hello world'),
      source: CaptureSource.File,
    });
    const text = await t.transcribe({
      samples: new Float32Array(16000),
      sampleRate: 16000,
    });
    expect(text).toBe('hello world');
    await t.close();
  });
  it('throws VoiceError with a hint on empty samples', async () => {
    const t = createInProcessTranscriber(cfg, {
      loadSherpa: fakeSherpa(''),
      source: CaptureSource.Mic,
    });
    await expect(
      t.transcribe({ samples: new Float32Array(0), sampleRate: 16000 }),
    ).rejects.toThrow(/no audio/i);
  });
});
