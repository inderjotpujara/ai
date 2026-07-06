import { expect, test } from 'bun:test';
import { kokoroStrategy } from '../../src/media/generate/audio-mlx.ts';

test('kokoro args carry text, file_prefix, default model and default voice', () => {
  const savedEnv = {
    AGENT_VOICE_MODEL: process.env.AGENT_VOICE_MODEL,
    AGENT_VOICE: process.env.AGENT_VOICE,
    AGENT_TTS_CMD: process.env.AGENT_TTS_CMD,
  };
  delete process.env.AGENT_VOICE_MODEL;
  delete process.env.AGENT_VOICE;
  delete process.env.AGENT_TTS_CMD;
  try {
    const buildOneShot = kokoroStrategy.buildOneShot;
    if (!buildOneShot) {
      throw new Error('buildOneShot must be defined');
    }
    const spec = buildOneShot('hello world', '/out.wav', {});
    expect(spec.cmd).toBe('mlx_audio.tts.generate');
    expect(spec.args).toContain('--text');
    expect(spec.args[spec.args.indexOf('--text') + 1]).toBe('hello world');
    expect(spec.args).not.toContain('--output_path');
    expect(spec.args).toContain('--file_prefix');
    expect(spec.args[spec.args.indexOf('--file_prefix') + 1]).toBe('/out');
    expect(spec.args).toContain('--model');
    expect(spec.args[spec.args.indexOf('--model') + 1]).toBe(
      'mlx-community/Kokoro-82M-bf16',
    );
    expect(spec.args).toContain('--voice');
    expect(spec.args[spec.args.indexOf('--voice') + 1]).toBe('af_heart');
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('kokoro outputPathFor maps outPath to the <prefix>_000.wav file mlx-audio actually writes', () => {
  const outputPathFor = kokoroStrategy.outputPathFor;
  if (!outputPathFor) {
    throw new Error('outputPathFor must be defined');
  }
  expect(outputPathFor('/tmp/x.wav')).toBe('/tmp/x_000.wav');
});
