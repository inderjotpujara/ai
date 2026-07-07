import { describe, expect, it } from 'bun:test';
import { captureFromFile } from '../../src/voice/capture.ts';

const cfg = { modelDir: '/m', ffmpeg: 'ffmpeg', timeoutMs: 5000 };

function pcmBytes(nSamples: number): Uint8Array {
  const f = new Float32Array(nSamples).fill(0.1);
  return new Uint8Array(f.buffer);
}

describe('captureFromFile', () => {
  it('decodes ffmpeg f32le stdout into Float32 samples at 16k', async () => {
    const frames = await captureFromFile('x.wav', cfg, {
      spawn: async () => ({ code: 0, stdout: pcmBytes(1600), stderr: '' }),
    });
    expect(frames.sampleRate).toBe(16000);
    expect(frames.samples.length).toBe(1600);
    expect(frames.samples[0]).toBeCloseTo(0.1, 5);
  });
  it('throws VoiceError when ffmpeg fails', async () => {
    await expect(
      captureFromFile('x.wav', cfg, {
        spawn: async () => ({
          code: 1,
          stdout: new Uint8Array(0),
          stderr: 'No such file',
        }),
      }),
    ).rejects.toThrow(/ffmpeg/i);
  });
});
