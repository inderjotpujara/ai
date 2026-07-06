// Live-verify for Slice 27 Phase A (analysis). Gated behind MULTIMODAL_LIVE=1.
// Drives the REAL engines on this machine: mlx-whisper (STT), ffmpeg (frames),
// and qwen2.5vl via Ollama (vision) through the actual media code path.
//
//   MULTIMODAL_LIVE=1 AGENT_STT_CMD=/tmp/mlxvenv/bin/mlx_whisper \
//     bun test tests/integration/multimodal.live.test.ts
//
// Requires: ffmpeg + macOS `say` on PATH; mlx_whisper CLI (AGENT_STT_CMD or PATH);
// Ollama up with qwen2.5vl:7b pulled.
import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVisionAgent } from '../../agents/vision.ts';
import { runDefinedAgent } from '../../src/core/agent-def.ts';
import { transcribe } from '../../src/media/audio/transcribe.ts';
import { runOneShotJob } from '../../src/media/generate/adapter.ts';
import { kokoroStrategy } from '../../src/media/generate/audio-mlx.ts';
import { mfluxStrategy } from '../../src/media/generate/image-mflux.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { MediaKind } from '../../src/media/types.ts';
import { sampleFrames } from '../../src/media/video/frames.ts';

const LIVE = process.env.MULTIMODAL_LIVE === '1';
const suite = LIVE ? describe : describe.skip;

function run(cmd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return proc.exited.then((code) => {
    if (code !== 0) throw new Error(`${cmd} exited ${code}`);
  });
}

suite('Slice 27 Phase A — multimodal analysis (live)', () => {
  let dir = '';
  let imgPath = '';
  let audioPath = '';
  let videoPath = '';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mm-live-'));
    imgPath = join(dir, 'img.png');
    audioPath = join(dir, 'speech.wav');
    videoPath = join(dir, 'vid.mp4');
    const aiff = join(dir, 'speech.aiff');
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240',
      '-frames:v',
      '1',
      imgPath,
    ]);
    await run('say', [
      '-o',
      aiff,
      'the quick brown fox jumps over the lazy dog',
    ]);
    await run('ffmpeg', ['-y', '-i', aiff, '-ar', '16000', audioPath]);
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=2',
      '-t',
      '3',
      videoPath,
    ]);
  });

  test('STT: real mlx-whisper transcribes speech to text', async () => {
    const text = await transcribe(audioPath, {
      cmd: process.env.AGENT_STT_CMD ?? '/tmp/mlxvenv/bin/mlx_whisper',
      model: process.env.MULTIMODAL_STT_MODEL ?? 'mlx-community/whisper-tiny',
    });
    expect(text.toLowerCase()).toContain('fox');
  }, 180_000);

  test('frames: real ffmpeg samples a video into a frame-group', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'mm-frames-')));
    const group = await sampleFrames(videoPath, store);
    expect(group.kind).toBe(MediaKind.Video);
    expect(group.frames?.length ?? 0).toBeGreaterThanOrEqual(2);
  }, 60_000);

  test('vision: real qwen2.5vl describes an image via the specialist path', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'mm-vision-')));
    const item = await store.put(
      MediaKind.Image,
      new Uint8Array(readFileSync(imgPath)),
      'image/png',
    );
    const agent = createVisionAgent({});
    const res = await runDefinedAgent(
      agent,
      `Describe what you see in one sentence. [img:${item.handle}]`,
      undefined,
      undefined,
      undefined,
      store,
    );
    expect(res.text.trim().length).toBeGreaterThan(10);
  }, 180_000);

  test('image-gen: real mflux (ungated mirror) produces a PNG via the generator', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'mm-imggen-')));
    const job = runOneShotJob(
      mfluxStrategy,
      'a red circle on a white background',
      store,
      'image/png',
      { steps: 2, width: 384, height: 384 },
    );
    const fh = await job.result();
    expect(fh.mediaType).toBe('image/png');
    expect(fh.sizeBytes).toBeGreaterThan(1000);
  }, 300_000);

  test('audio-gen: real Kokoro TTS produces a wav via the generator', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'mm-ttsgen-')));
    const job = runOneShotJob(
      kokoroStrategy,
      'hello from slice twenty seven',
      store,
      'audio/wav',
      {},
    );
    const fh = await job.result();
    expect(fh.mediaType).toBe('audio/wav');
    expect(fh.sizeBytes).toBeGreaterThan(1000);
  }, 180_000);
});
