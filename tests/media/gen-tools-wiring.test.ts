import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaVenv } from '../../src/media/cmd-resolve.ts';
import type { GenModelCandidate } from '../../src/media/generate/catalog.ts';
import { GenEngine } from '../../src/media/generate/catalog.ts';
import { createGenerateTools } from '../../src/media/generate/tools.ts';
import { createMediaStore } from '../../src/media/store.ts';
import { ExecMode, MediaKind } from '../../src/media/types.ts';
import type { SpawnFn } from '../../src/runtime/process-supervisor.ts';

describe('createGenerateTools no-fit degrade', () => {
  test('generate_image returns a graceful message when no model fits', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-')));
    const tools = createGenerateTools(store, {
      selectModel: async () => undefined, // force no-fit
    });
    const result = await tools.generate_image?.execute?.(
      { prompt: 'x' },
      {} as never,
    );
    expect(String(result).toLowerCase()).toContain('no ');
    expect(String(result).toLowerCase()).toContain('image');
  });
});

describe('createGenerateTools engine-failure degrade', () => {
  test('generate_image returns a graceful message (never throws) when the engine itself fails', async () => {
    const store = createMediaStore(mkdtempSync(join(tmpdir(), 'gen-fail-')));
    const candidate: GenModelCandidate = {
      kind: MediaKind.Image,
      repo: 'fake/repo',
      engine: GenEngine.Mflux,
      venv: MediaVenv.Media,
      execMode: ExecMode.OneShot,
      footprint: { approxParamsBillions: 1, bytesPerWeight: 1 },
      label: 'fake candidate',
    };
    // Spawns successfully but the child process exits non-zero — adapter.ts's
    // runOneShotJob rejects job.result() with `generation failed (exit 1)`.
    const spawn: SpawnFn = () => ({
      pid: 1,
      kill() {},
      onExit: (cb) => cb(1),
    });
    const tools = createGenerateTools(store, {
      spawn,
      selectModel: async () => candidate,
    });
    const result = await tools.generate_image?.execute?.(
      { prompt: 'x' },
      {} as never,
    );
    expect(typeof result).toBe('string');
    expect(String(result).toLowerCase()).toContain('failed');
    expect(String(result).toLowerCase()).toContain('not generated');
  });
});
