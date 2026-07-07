import { describe, expect, test } from 'bun:test';
import { GEN_CATALOG, GenEngine } from '../../src/media/generate/catalog.ts';
import { MediaKind } from '../../src/media/types.ts';

describe('GEN_CATALOG', () => {
  test('covers all three generation kinds', () => {
    const kinds = new Set(GEN_CATALOG.map((c) => c.kind));
    expect(kinds.has(MediaKind.Image)).toBe(true);
    expect(kinds.has(MediaKind.Audio)).toBe(true);
    expect(kinds.has(MediaKind.Video)).toBe(true);
  });

  test('every candidate is well-formed (positive footprint, non-empty repo/label)', () => {
    for (const c of GEN_CATALOG) {
      expect(c.repo.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.footprint.approxParamsBillions).toBeGreaterThan(0);
      expect(c.footprint.bytesPerWeight).toBeGreaterThan(0);
      expect(Object.values(GenEngine)).toContain(c.engine);
    }
  });

  test('the video ladder spans both engines (mlx-video one-shot + comfy-wan server)', () => {
    const videoEngines = new Set(
      GEN_CATALOG.filter((c) => c.kind === MediaKind.Video).map(
        (c) => c.engine,
      ),
    );
    expect(videoEngines.has(GenEngine.MlxVideo)).toBe(true);
    expect(videoEngines.has(GenEngine.ComfyWan)).toBe(true);
  });

  test('the image anchor is the ungated pre-quantized FLUX mirror', () => {
    const image = GEN_CATALOG.filter((c) => c.kind === MediaKind.Image);
    expect(
      image.some((c) => c.repo === 'dhairyashil/FLUX.1-schnell-mflux-4bit'),
    ).toBe(true);
  });
});
