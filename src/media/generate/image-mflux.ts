import { MediaVenv, resolveMediaCmd } from '../cmd-resolve.ts';
import { ExecMode, MediaKind } from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';

/** mflux image generation strategy: builds a one-shot command invocation.
 *  Model selection follows env-pin semantics: opts.model takes precedence,
 *  falling back to AGENT_IMAGE_MODEL env var, then a hardcoded default.
 *  The default is `dhairyashil/FLUX.1-schnell-mflux-4bit` — an ungated,
 *  pre-quantized (4-bit) mirror of FLUX.1-schnell, i.e. a schnell-architecture
 *  repo. Live-verify proved `--model schnell` (which resolves to
 *  `black-forest-labs/FLUX.1-schnell`) fails out-of-the-box: that repo is
 *  HuggingFace-gated and 401s without a token. The mirror downloads
 *  unauthenticated and generates correctly, so image-gen works with zero
 *  setup. Set AGENT_IMAGE_MODEL to `schnell`, `dev`, etc. only if you've
 *  accepted the gated FLUX license and configured an HF token — and if the
 *  override points at a different architecture (e.g. `dev` instead of
 *  `schnell`), also set AGENT_IMAGE_BASE_MODEL to match, since `--base-model`
 *  tells mflux which architecture/config to use regardless of which model
 *  repo `--model` points at; it defaults to `schnell` to match the default
 *  model above.
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
    const baseModel = process.env.AGENT_IMAGE_BASE_MODEL ?? 'schnell';
    const steps = String(opts.steps ?? 4);
    const height = String(opts.height ?? 1024);
    const width = String(opts.width ?? 1024);

    return {
      // Env-configurable binary (mirrors AGENT_STT_CMD/AGENT_TTS_CMD); falls
      // back to the installed media venv's binary, then bare PATH lookup.
      cmd:
        process.env.AGENT_IMAGE_CMD ??
        resolveMediaCmd('mflux-generate', MediaVenv.Media),
      args: [
        '--model',
        model,
        '--base-model',
        baseModel,
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
