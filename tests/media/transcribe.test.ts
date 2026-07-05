import { expect, test } from 'bun:test';
import { transcribe } from '../../src/media/audio/transcribe.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

test('spawns mlx_whisper and returns the transcript text', async () => {
  let seen: string[] = [];
  const spawn: SpawnFn = (_cmd, args) => {
    seen = args;
    return { pid: 1, kill() {}, onExit: (cb) => cb(0) };
  };
  const text = await transcribe('/tmp/a.wav', {
    spawn,
    readJson: async () => ({ text: 'hi' }),
    model: 'whisper-large-v3-turbo',
    outDir: '/tmp/o',
  });
  expect(text).toBe('hi');
  expect(seen).toContain('--output-format');
  expect(seen).toContain('/tmp/a.wav');
});

test('rejects when the process exits non-zero', async () => {
  const spawn: SpawnFn = () => ({ pid: 1, kill() {}, onExit: (cb) => cb(1) });
  await expect(
    transcribe('/tmp/a.wav', { spawn, readJson: async () => ({ text: '' }) }),
  ).rejects.toThrow('transcription failed');
});
