import { expect, test } from 'bun:test';
import { kokoroStrategy } from '../../src/media/generate/audio-mlx.ts';

test('kokoro args carry text, output, default model and default voice', () => {
  const buildOneShot = kokoroStrategy.buildOneShot;
  if (!buildOneShot) {
    throw new Error('buildOneShot must be defined');
  }
  const spec = buildOneShot('hello world', '/out.wav', {});
  expect(spec.cmd).toBe('mlx_audio.tts.generate');
  expect(spec.args).toContain('--text');
  expect(spec.args[spec.args.indexOf('--text') + 1]).toBe('hello world');
  expect(spec.args).toContain('--output_path');
  expect(spec.args[spec.args.indexOf('--output_path') + 1]).toBe('/out.wav');
  expect(spec.args).toContain('--model');
  expect(spec.args[spec.args.indexOf('--model') + 1]).toBe(
    'mlx-community/Kokoro-82M-bf16',
  );
  expect(spec.args).toContain('--voice');
  expect(spec.args[spec.args.indexOf('--voice') + 1]).toBe('af_heart');
});
