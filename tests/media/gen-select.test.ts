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
});
