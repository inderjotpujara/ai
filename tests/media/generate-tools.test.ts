import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGenerateTools } from '../../src/media/generate/tools.ts';
import { createMediaStore } from '../../src/media/store.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

test('generate_image writes a file and returns a text summary with a .png path', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-tools-')));
  const spawn: SpawnFn = (_cmd, args) => {
    const outPath = args[args.indexOf('--output') + 1] ?? '';
    writeFileSync(outPath, new Uint8Array([1, 2, 3]));
    return { pid: 1, kill() {}, onExit: (cb) => cb(0) };
  };
  const tools = createGenerateTools(store, { spawn });
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
  const tools = createGenerateTools(store, { spawn });
  const result = await tools.generate_speech?.execute?.(
    { prompt: 'hello there' },
    {} as never,
  );
  expect(typeof result).toBe('string');
  expect(result as string).toMatch(/\.wav$/);
});

test('generate tools never return raw bytes, only a text summary', async () => {
  const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-tools-')));
  const spawn: SpawnFn = (_cmd, args) => {
    const outPath = args[args.indexOf('--output') + 1] ?? '';
    writeFileSync(outPath, new Uint8Array([1]));
    return { pid: 3, kill() {}, onExit: (cb) => cb(0) };
  };
  const tools = createGenerateTools(store, { spawn });
  const result = await tools.generate_image?.execute?.(
    { prompt: 'x' },
    {} as never,
  );
  expect(result).not.toBeInstanceOf(Uint8Array);
  expect(result as string).toContain('Generated image:');
});
