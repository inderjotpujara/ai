import { describe, expect, test } from 'bun:test';
import { ContentPolicy } from '../../src/core/types.ts';
import { MediaVenv } from '../../src/media/cmd-resolve.ts';
import type { GenModelCandidate } from '../../src/media/generate/catalog.ts';
import { GenEngine } from '../../src/media/generate/catalog.ts';
import { selectGenModel } from '../../src/media/generate/select.ts';
import { ExecMode, MediaKind } from '../../src/media/types.ts';

const img = (
  repo: string,
  params: number,
  extra: Partial<GenModelCandidate> = {},
): GenModelCandidate => ({
  kind: MediaKind.Image,
  repo,
  engine: GenEngine.Mflux,
  venv: MediaVenv.Media,
  execMode: ExecMode.OneShot,
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.55 },
  label: repo,
  ...extra,
});

const GB = 1_000_000_000;

describe('selectGenModel', () => {
  test('picks the largest candidate that fits the budget', async () => {
    const catalog = [img('small', 2), img('mid', 12), img('huge', 200)];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: {},
      budgetBytes: 20 * GB,
      isInstalled: () => true,
      catalog,
    });
    expect(chosen?.repo).toBe('mid'); // 200B doesn't fit; 12B is largest that does
  });

  test('returns undefined when nothing fits (no crash)', async () => {
    const catalog = [img('huge', 200)];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: {},
      budgetBytes: 1 * GB,
      isInstalled: () => true,
      catalog,
    });
    expect(chosen).toBeUndefined();
  });

  test('env pin is authoritative — returns the pinned repo, no ranking', async () => {
    const catalog = [img('mid', 12)];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: { AGENT_IMAGE_MODEL: 'my/custom-model' },
      budgetBytes: 1, // would fit nothing, but pin bypasses ranking
      isInstalled: () => false,
      catalog,
    });
    expect(chosen?.repo).toBe('my/custom-model');
  });

  test('drops uncensored candidates when uncensored is disabled', async () => {
    const catalog = [
      img('clean', 12),
      img('dolphin-x', 20, { contentPolicy: ContentPolicy.Uncensored }),
    ];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: { AGENT_UNCENSORED: '0' },
      budgetBytes: 50 * GB,
      isInstalled: () => true,
      catalog,
    });
    expect(chosen?.repo).toBe('clean'); // 20B dolphin filtered out despite being larger
  });

  test('consent-gates a pull: declining skips to the next installed candidate', async () => {
    const catalog = [img('big-uninstalled', 20), img('small-installed', 12)];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: {},
      budgetBytes: 50 * GB,
      isInstalled: (c) => c.repo === 'small-installed',
      askConsent: async () => false, // decline the big one's download
      catalog,
    });
    expect(chosen?.repo).toBe('small-installed');
  });

  test('consent-gates a pull: granting picks the not-installed candidate that fits', async () => {
    const catalog = [img('big-uninstalled', 20)];
    const chosen = await selectGenModel(MediaKind.Image, {
      env: {},
      budgetBytes: 50 * GB,
      isInstalled: () => false,
      askConsent: async () => true, // grant the download
      catalog,
    });
    expect(chosen?.repo).toBe('big-uninstalled');
  });

  test('env pin picks the matching engine, not the first catalog entry (video spans two engines)', async () => {
    // ComfyWan (server) entry listed FIRST — reproduces the first-match bug —
    // followed by the real mlx-video (one-shot) entry the pin targets.
    const catalog: GenModelCandidate[] = [
      {
        kind: MediaKind.Video,
        repo: 'city96/LTX-Video-0.9.6-distilled-gguf',
        engine: GenEngine.ComfyWan,
        venv: MediaVenv.Video,
        execMode: ExecMode.Server,
        footprint: { approxParamsBillions: 2, bytesPerWeight: 2.0 },
        label: 'LTX-Video 0.9.6 distilled GGUF (ComfyUI)',
      },
      {
        kind: MediaKind.Video,
        repo: 'dgrauet/ltx-2.3-mlx-q4',
        engine: GenEngine.MlxVideo,
        venv: MediaVenv.Video,
        execMode: ExecMode.OneShot,
        footprint: { approxParamsBillions: 22, bytesPerWeight: 0.55 },
        label: 'LTX-2.3 int4 (mlx-video)',
      },
    ];
    const chosen = await selectGenModel(MediaKind.Video, {
      env: { AGENT_VIDEO_MODEL: 'dgrauet/ltx-2.3-mlx-q4' },
      catalog,
    });
    expect(chosen?.engine).toBe(GenEngine.MlxVideo);
    expect(chosen?.execMode).toBe(ExecMode.OneShot);
  });

  test('ranks by footprint bytes, not params: same-param quant tiers do not tie', async () => {
    // Same params (12B) as FLUX 4bit vs 8bit — only bytesPerWeight differs.
    // 4bit listed FIRST so a params-only sort (stable) would always pick it.
    const catalog = [
      img('flux-4bit', 12, {
        footprint: { approxParamsBillions: 12, bytesPerWeight: 0.55 },
      }),
      img('flux-8bit', 12, {
        footprint: { approxParamsBillions: 12, bytesPerWeight: 1.1 },
      }),
    ];
    const bothFit = await selectGenModel(MediaKind.Image, {
      env: {},
      budgetBytes: 20 * GB, // fits both 4bit (~7.9GB) and 8bit (~15.8GB)
      isInstalled: () => true,
      catalog,
    });
    expect(bothFit?.repo).toBe('flux-8bit'); // larger bytes wins on fidelity

    const onlySmallFits = await selectGenModel(MediaKind.Image, {
      env: {},
      budgetBytes: 10 * GB, // fits 4bit (~7.9GB) but not 8bit (~15.8GB)
      isInstalled: () => true,
      catalog,
    });
    expect(onlySmallFits?.repo).toBe('flux-4bit');
  });

  test("env pin to an unknown repo falls to the kind's one-shot default, not the first entry", async () => {
    const catalog: GenModelCandidate[] = [
      {
        kind: MediaKind.Video,
        repo: 'city96/LTX-Video-0.9.6-distilled-gguf',
        engine: GenEngine.ComfyWan,
        venv: MediaVenv.Video,
        execMode: ExecMode.Server,
        footprint: { approxParamsBillions: 2, bytesPerWeight: 2.0 },
        label: 'LTX-Video 0.9.6 distilled GGUF (ComfyUI)',
      },
      {
        kind: MediaKind.Video,
        repo: 'dgrauet/ltx-2.3-mlx-q4',
        engine: GenEngine.MlxVideo,
        venv: MediaVenv.Video,
        execMode: ExecMode.OneShot,
        footprint: { approxParamsBillions: 22, bytesPerWeight: 0.55 },
        label: 'LTX-2.3 int4 (mlx-video)',
      },
    ];
    const chosen = await selectGenModel(MediaKind.Video, {
      env: { AGENT_VIDEO_MODEL: 'some/unknown-repo' },
      catalog,
    });
    expect(chosen?.execMode).toBe(ExecMode.OneShot);
  });
});
