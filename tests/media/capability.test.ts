import { expect, test } from 'bun:test';
import { Capability } from '../../src/core/types.ts';

test('generation capabilities are declared', () => {
  expect(Capability.ImageGen).toBe('image_gen' as Capability);
  expect(Capability.SpeechGen).toBe('speech_gen' as Capability);
  expect(Capability.VideoGen).toBe('video_gen' as Capability);
});
