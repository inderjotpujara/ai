import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaStore } from '../../src/media/store.ts';
import { MediaKind } from '../../src/media/types.ts';
import { buildFfmpegArgs, sampleFrames } from '../../src/media/video/frames.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

test('ffmpeg args apply adaptive fps + scale', () => {
  const args = buildFfmpegArgs('/in.mp4', '/out/frame_%04d.jpg', {
    fps: 1,
    maxFrames: 30,
    longEdge: 768,
  });
  const vf = args[args.indexOf('-vf') + 1];
  expect(vf).toContain('fps=1');
  expect(vf).toContain('768');
  expect(args).toContain('/in.mp4');
});

test('sampleFrames spawns ffmpeg, stores frames, and returns a group item', async () => {
  const framesDir = mkdtempSync(join(tmpdir(), 'frames-src-'));
  const framePaths = ['frame_0001.jpg', 'frame_0002.jpg', 'frame_0003.jpg'].map(
    (name) => {
      const p = join(framesDir, name);
      writeFileSync(p, new Uint8Array([1, 2, 3]));
      return p;
    },
  );

  const spawn: SpawnFn = () => ({ pid: 1, kill() {}, onExit: (cb) => cb(0) });
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'mediastore-')));

  const item = await sampleFrames('/in.mp4', store, {
    spawn,
    listFrames: () => framePaths,
  });

  expect(item.kind).toBe(MediaKind.Video);
  expect(item.frames?.length).toBe(3);
  expect(store.get(item.handle)).toEqual(item);
});

test('sampleFrames rejects when ffmpeg exits non-zero', async () => {
  const spawn: SpawnFn = () => ({ pid: 1, kill() {}, onExit: (cb) => cb(1) });
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'mediastore-')));
  await expect(
    sampleFrames('/in.mp4', store, { spawn, listFrames: () => [] }),
  ).rejects.toThrow('frame sampling failed');
});
