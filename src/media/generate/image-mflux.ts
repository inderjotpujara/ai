import { ExecMode, MediaKind } from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';

/** mflux image generation strategy: builds a one-shot command invocation.
 *  Model selection follows env-pin semantics: opts.model takes precedence,
 *  falling back to AGENT_IMAGE_MODEL env var, then a hardcoded default.
 *  The default is `dhairyashil/FLUX.1-schnell-mflux-4bit` — an ungated,
 *  pre-quantized (4-bit) mirror of FLUX.1-schnell. Live-verify proved
 *  `--model schnell` (which resolves to `black-forest-labs/FLUX.1-schnell`)
 *  fails out-of-the-box: that repo is HuggingFace-gated and 401s without a
 *  token. The mirror downloads unauthenticated and generates correctly, so
 *  image-gen works with zero setup. Set AGENT_IMAGE_MODEL to `schnell`,
 *  `dev`, etc. only if you've accepted the gated FLUX license and configured
 *  an HF token. `--base-model schnell` tells mflux which architecture/config
 *  to use regardless of which model repo `--model` points at.
 *  Since the default model is already 4-bit quantized, no `-q` flag is
 *  passed — quantizing an already-quantized model would be wrong.
 *  Note: mflux has no safety checker, so disableSafetyChecker is a documented no-op. */
export const mfluxStrategy: GenStrategy = {
  kind: MediaKind.Image,
  execMode: ExecMode.OneShot,
  buildOneShot(prompt: string, outPath: string, opts: GenOpts) {
    const model =
      opts.model ??
      process.env.AGENT_IMAGE_MODEL ??
      'dhairyashil/FLUX.1-schnell-mflux-4bit';
    const steps = String(opts.steps ?? 4);
    const height = String(opts.height ?? 1024);
    const width = String(opts.width ?? 1024);

    return {
      // Env-configurable binary (mirrors AGENT_STT_CMD/AGENT_TTS_CMD) so a
      // venv install location works without relying on PATH.
      cmd: process.env.AGENT_IMAGE_CMD ?? 'mflux-generate',
      args: [
        '--model',
        model,
        '--base-model',
        'schnell',
        '--steps',
        steps,
        '--width',
        width,
        '--height',
        height,
        '--prompt',
        prompt,
        '--output',
        outPath,
      ],
    };
  },
};
