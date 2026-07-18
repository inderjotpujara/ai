import { expect, test } from 'bun:test';
import type { VoiceFrames } from '../../src/contracts/voice.ts';

test('VoiceFrames is a plain {samples,sampleRate:16000} shape (contracts, no zod — D5 exception)', () => {
  const frames: VoiceFrames = {
    samples: new Float32Array([0.1, -0.2, 0.3]),
    sampleRate: 16000,
  };
  expect(frames.sampleRate).toBe(16000);
  expect(frames.samples).toBeInstanceOf(Float32Array);
  expect(frames.samples.length).toBe(3);
});
