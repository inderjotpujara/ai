import type { ContentPolicy } from '../../core/types.ts';
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
