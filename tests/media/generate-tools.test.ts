import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaVenv } from '../../src/media/cmd-resolve.ts';
import type { GenModelCandidate } from '../../src/media/generate/catalog.ts';
import { GenEngine } from '../../src/media/generate/catalog.ts';
import { createGenerateTools } from '../../src/media/generate/tools.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { ExecMode, MediaKind } from '../../src/media/types.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

/** A fit-selected candidate fixture — the tools now fit-select a model before
 *  running, so every test that exercises a real generation must inject one
 *  via the `selectModel` seam (real `selectGenModel` depends on live
 *  hardware/installed-model state, which these tests must not depend on). */
function fakeCandidate(kind: MediaKind, engine: GenEngine): GenModelCandidate {
  return {
    kind,
    repo: 'fake/repo',
    engine,
    venv: MediaVenv.Media,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 1, bytesPerWeight: 1 },
    label: 'fake candidate',
  };
}

test('generate_image writes a file and returns a text summary with a .png path', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-tools-')));
  const spawn: SpawnFn = (_cmd, args) => {
    const outPath = args[args.indexOf('--output') + 1] ?? '';
    writeFileSync(outPath, new Uint8Array([1, 2, 3]));
    return { pid: 1, kill() {}, onExit: (cb) => cb(0) };
  };
  const tools = createGenerateTools(store, {
    spawn,
    selectModel: async () => fakeCandidate(MediaKind.Image, GenEngine.Mflux),
  });
  const result = await tools.generate_image?.execute?.(
    { prompt: 'a fox in a field' },
    {} as never,
  );
  expect(typeof result).toBe('string');
  expect(result as string).toMatch(/\.png$/);
});

test('generate_speech writes a file and returns a text summary with a .wav path', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-tools-')));
  const spawn: SpawnFn = (_cmd, args) => {
    const prefix = args[args.indexOf('--file_prefix') + 1] ?? '';
    // Mimic Kokoro: writes `<prefix>_000.wav`, not the exact allocated path.
    writeFileSync(`${prefix}_000.wav`, new Uint8Array([9]));
    return { pid: 2, kill() {}, onExit: (cb) => cb(0) };
  };
  const tools = createGenerateTools(store, {
    spawn,
    selectModel: async () => fakeCandidate(MediaKind.Audio, GenEngine.MlxAudio),
  });
  const result = await tools.generate_speech?.execute?.(
    { prompt: 'hello there' },
    {} as never,
  );
  expect(typeof result).toBe('string');
  expect(result as string).toMatch(/\.wav$/);
});

test('generate_video writes a file and returns a text summary with a .mp4 path', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-tools-')));
  const spawn: SpawnFn = (_cmd, args) => {
    const outPath = args[args.indexOf('--output-path') + 1] ?? '';
    writeFileSync(outPath, new Uint8Array([4, 5, 6]));
    return { pid: 4, kill() {}, onExit: (cb) => cb(0) };
  };
  const tools = createGenerateTools(store, {
    spawn,
    // Force the one-shot (mlx-video/LTX) engine binary to look "found" so
    // runGenJob doesn't degrade to the server (ComfyUI) fallback the video
    // tool always wires in — the real binary isn't installed in this
    // environment, but this test only exercises the one-shot lane.
    which: () => '/fake/bin/mlx_video',
    selectModel: async () => fakeCandidate(MediaKind.Video, GenEngine.MlxVideo),
  } as never);
  const result = await tools.generate_video?.execute?.(
    { prompt: 'a drone flying over mountains' },
    {} as never,
  );
  expect(typeof result).toBe('string');
  expect(result as string).toMatch(/\.mp4$/);
});

test('generate tools never return raw bytes, only a text summary', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-tools-')));
  const spawn: SpawnFn = (_cmd, args) => {
    const outPath = args[args.indexOf('--output') + 1] ?? '';
    writeFileSync(outPath, new Uint8Array([1]));
    return { pid: 3, kill() {}, onExit: (cb) => cb(0) };
  };
  const tools = createGenerateTools(store, {
    spawn,
    selectModel: async () => fakeCandidate(MediaKind.Image, GenEngine.Mflux),
  });
  const result = await tools.generate_image?.execute?.(
    { prompt: 'x' },
    {} as never,
  );
  expect(result).not.toBeInstanceOf(Uint8Array);
  expect(result as string).toContain('Generated image:');
});
