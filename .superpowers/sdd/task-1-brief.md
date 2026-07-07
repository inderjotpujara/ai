### Task 1: Gen candidate catalog

**Files:**
- Create: `src/media/generate/catalog.ts`
- Test: `tests/media/gen-catalog.test.ts`

**Interfaces:**
- Consumes: `MediaKind`, `ExecMode` from `src/media/types.ts`; `MediaVenv` from `src/media/cmd-resolve.ts`; `ContentPolicy` from `src/core/types.ts`.
- Produces: `GenEngine`, `GenModelCandidate`, `GEN_CATALOG` (see locked interfaces above).

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/gen-catalog.test.ts
import { describe, expect, test } from 'bun:test';
import { MediaKind } from '../../src/media/types.ts';
import { GEN_CATALOG, GenEngine } from '../../src/media/generate/catalog.ts';

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
      GEN_CATALOG.filter((c) => c.kind === MediaKind.Video).map((c) => c.engine),
    );
    expect(videoEngines.has(GenEngine.MlxVideo)).toBe(true);
    expect(videoEngines.has(GenEngine.ComfyWan)).toBe(true);
  });

  test('the image anchor is the ungated pre-quantized FLUX mirror', () => {
    const image = GEN_CATALOG.filter((c) => c.kind === MediaKind.Image);
    expect(image.some((c) => c.repo === 'dhairyashil/FLUX.1-schnell-mflux-4bit')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file -- "tests/media/gen-catalog.test.ts"`
Expected: FAIL — cannot find module `catalog.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/media/generate/catalog.ts
import { ContentPolicy } from '../../core/types.ts';
import { MediaVenv } from '../cmd-resolve.ts';
import { ExecMode, MediaKind } from '../types.ts';

/** Which generation engine a candidate runs under; maps to a GenStrategy in
 *  the tool layer. */
export enum GenEngine {
  Mflux = 'mflux',
  MlxAudio = 'mlx-audio',
  MlxVideo = 'mlx-video',
  ComfyWan = 'comfy-wan',
}

/** A hardware-fit-rankable generation model. Deliberately NOT a
 *  `ModelDeclaration`: gen has no runtime and produces a file via a spawned
 *  CLI, so it carries an engine/venv/exec-mode instead of a RuntimeKind, and
 *  is ranked by footprint against the live budget rather than warmed into a
 *  server (see reference-gen-fit-impedance-mismatch). */
export type GenModelCandidate = {
  kind: MediaKind;
  repo: string;
  engine: GenEngine;
  venv: MediaVenv;
  execMode: ExecMode;
  footprint: { approxParamsBillions: number; bytesPerWeight: number };
  contentPolicy?: ContentPolicy;
  label: string;
};

/**
 * Seeded small→large ladders per kind. Footprints web-validated 2026-07-06
 * (reference-gen-model-catalog-2026). `bytesPerWeight` reflects the effective
 * on-disk quant (4bit≈0.55, 8bit≈1.1, bf16≈2.0), used only for relative
 * fit-ranking against the live budget — not an exact byte count.
 */
export const GEN_CATALOG: GenModelCandidate[] = [
  // Image — mflux (one-shot). Small anchor is ungated + pre-quantized.
  {
    kind: MediaKind.Image,
    repo: 'dhairyashil/FLUX.1-schnell-mflux-4bit',
    engine: GenEngine.Mflux,
    venv: MediaVenv.Media,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 12, bytesPerWeight: 0.55 },
    label: 'FLUX.1-schnell 4bit (mflux)',
  },
  {
    kind: MediaKind.Image,
    repo: 'dhairyashil/FLUX.1-schnell-mflux-8bit',
    engine: GenEngine.Mflux,
    venv: MediaVenv.Media,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 12, bytesPerWeight: 1.1 },
    label: 'FLUX.1-schnell 8bit (mflux)',
  },
  // Speech — mlx-audio (one-shot). Kokoro is filter-free + no cloning.
  {
    kind: MediaKind.Audio,
    repo: 'mlx-community/Kokoro-82M-bf16',
    engine: GenEngine.MlxAudio,
    venv: MediaVenv.Media,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 0.082, bytesPerWeight: 2.0 },
    label: 'Kokoro-82M (mlx-audio)',
  },
  {
    kind: MediaKind.Audio,
    repo: 'mlx-community/csm-1b',
    engine: GenEngine.MlxAudio,
    venv: MediaVenv.Media,
    execMode: ExecMode.OneShot,
    footprint: { approxParamsBillions: 1, bytesPerWeight: 2.0 },
    label: 'Sesame CSM-1B voice clone (mlx-audio)',
  },
  // Video — spans mlx-video (one-shot) + ComfyUI/Wan (server). Ladder.
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
  {
    kind: MediaKind.Video,
    repo: 'QuantStack/Wan2.2-TI2V-5B-GGUF',
    engine: GenEngine.ComfyWan,
    venv: MediaVenv.Video,
    execMode: ExecMode.Server,
    footprint: { approxParamsBillions: 5, bytesPerWeight: 1.1 },
    label: 'Wan2.2 TI2V-5B GGUF (ComfyUI)',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file -- "tests/media/gen-catalog.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/media/generate/catalog.ts tests/media/gen-catalog.test.ts
git commit -m "feat(media): gen model candidate catalog (image/speech/video ladders)"
```

---

