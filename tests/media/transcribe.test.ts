import { expect, test } from 'bun:test';
import { transcribe } from '../../src/media/audio/transcribe.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

test('spawns the mlx_whisper CLI (not `python3 -m`) and returns the transcript text', async () => {
  let seenCmd = '';
  let seen: string[] = [];
  const spawn: SpawnFn = (cmd, args) => {
    seenCmd = cmd;
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
  // The CLI entry point is the supported invocation; `python3 -m mlx_whisper`
  // fails at runtime (no __main__) — live-verify caught this. Guard both.
  expect(seenCmd).toBe('mlx_whisper');
  expect(seen).not.toContain('-m');
  expect(seen).toContain('--output-format');
  expect(seen).toContain('/tmp/a.wav');
});

test('honors AGENT_STT_CMD override for the whisper binary', async () => {
  const prev = process.env.AGENT_STT_CMD;
  process.env.AGENT_STT_CMD = '/opt/venv/bin/mlx_whisper';
  try {
    let seenCmd = '';
    const spawn: SpawnFn = (cmd) => {
      seenCmd = cmd;
      return { pid: 1, kill() {}, onExit: (cb) => cb(0) };
    };
    await transcribe('/tmp/a.wav', {
      spawn,
      readJson: async () => ({ text: 'x' }),
      outDir: '/tmp/o',
    });
    expect(seenCmd).toBe('/opt/venv/bin/mlx_whisper');
  } finally {
    if (prev === undefined) delete process.env.AGENT_STT_CMD;
    else process.env.AGENT_STT_CMD = prev;
  }
});

test('rejects when the process exits non-zero', async () => {
  const spawn: SpawnFn = () => ({ pid: 1, kill() {}, onExit: (cb) => cb(1) });
  await expect(
    transcribe('/tmp/a.wav', { spawn, readJson: async () => ({ text: '' }) }),
  ).rejects.toThrow('transcription failed');
});

test('a never-exiting process is killed and the call rejects within the injected timeout', async () => {
  let killedWith: NodeJS.Signals | undefined;
  const spawn: SpawnFn = () => ({
    pid: 1,
    kill: (sig) => {
      killedWith = sig;
    },
    onExit: () => {
      // never calls back — simulates a hung whisper process
    },
  });
  await expect(
    transcribe('/tmp/a.wav', {
      spawn,
      readJson: async () => ({ text: '' }),
      timeoutMs: 20,
    }),
  ).rejects.toThrow('timeout');
  expect(killedWith).toBe('SIGTERM');
});
