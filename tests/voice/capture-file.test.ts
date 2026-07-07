import { describe, expect, it } from 'bun:test';
import {
  captureFromFile,
  carryPcmChunk,
  MAX_CAPTURE_SAMPLES,
} from '../../src/voice/capture.ts';

const cfg = { modelDir: '/m', ffmpeg: 'ffmpeg', timeoutMs: 5000 };
const exists = () => true;

function pcmBytes(nSamples: number): Uint8Array {
  const f = new Float32Array(nSamples).fill(0.1);
  return new Uint8Array(f.buffer);
}

describe('captureFromFile', () => {
  it('decodes ffmpeg f32le stdout into Float32 samples at 16k', async () => {
    const frames = await captureFromFile('x.wav', cfg, {
      exists,
      spawn: async () => ({ code: 0, stdout: pcmBytes(1600), stderr: '' }),
    });
    expect(frames.sampleRate).toBe(16000);
    expect(frames.samples.length).toBe(1600);
    expect(frames.samples[0]).toBeCloseTo(0.1, 5);
  });
  it('throws VoiceError when ffmpeg fails', async () => {
    await expect(
      captureFromFile('x.wav', cfg, {
        exists,
        spawn: async () => ({
          code: 1,
          stdout: new Uint8Array(0),
          stderr: 'No such file',
        }),
      }),
    ).rejects.toThrow(/ffmpeg/i);
  });
  it('throws VoiceError before spawning when the file does not exist', async () => {
    let spawned = false;
    await expect(
      captureFromFile('missing.wav', cfg, {
        exists: () => false,
        spawn: async () => {
          spawned = true;
          return { code: 0, stdout: pcmBytes(1600), stderr: '' };
        },
      }),
    ).rejects.toThrow(/not found/i);
    expect(spawned).toBe(false);
  });
  it('truncates a decode that exceeds MAX_CAPTURE_SAMPLES instead of throwing', async () => {
    const over = MAX_CAPTURE_SAMPLES + 1600;
    const frames = await captureFromFile('big.wav', cfg, {
      exists,
      spawn: async () => ({ code: 0, stdout: pcmBytes(over), stderr: '' }),
    });
    expect(frames.samples.length).toBe(MAX_CAPTURE_SAMPLES);
  });
});

describe('carryPcmChunk', () => {
  it('carries a misaligned remainder across chunk boundaries without dropping or shifting samples', () => {
    // 5 float32 samples worth of bytes, split at a byte offset (6) that is
    // NOT a multiple of 4 — the misaligned split real ffmpeg pipe reads can
    // produce.
    const full = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    // Compare against `full`'s own values (float32-rounded), not the literal
    // decimals, since 0.1 etc. don't round-trip exactly through float32.
    const expected = Array.from(full);
    const bytes = new Uint8Array(full.buffer);
    const chunkA = bytes.subarray(0, 6); // 1 whole sample + 2 leftover bytes
    const chunkB = bytes.subarray(6); // rest, starting mid-sample

    const first = carryPcmChunk(new Uint8Array(0), chunkA);
    expect(Array.from(first.floats)).toEqual(expected.slice(0, 1));
    expect(first.leftover.byteLength).toBe(2);

    const second = carryPcmChunk(first.leftover, chunkB);
    expect(second.floats.length).toBe(4);
    expect(Array.from(second.floats)).toEqual(expected.slice(1));
    expect(second.leftover.byteLength).toBe(0);
  });

  it('discards a trailing sub-4-byte remainder with no more data (stream end)', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]); // 1 whole sample + 2 leftover
    const result = carryPcmChunk(new Uint8Array(0), bytes);
    expect(result.floats.length).toBe(1);
    expect(result.leftover.byteLength).toBe(2);
    // Nothing else arrives — the leftover is simply never consumed, i.e.
    // correctly discarded.
  });

  it('yields no floats when combined bytes are still under 4', () => {
    const result = carryPcmChunk(new Uint8Array([1]), new Uint8Array([2]));
    expect(result.floats.length).toBe(0);
    expect(result.leftover.byteLength).toBe(2);
  });
});
