import type { ExecMode, MediaKind } from '../types.ts';
import {
  ExecMode as ExecModeEnum,
  MediaKind as MediaKindEnum,
} from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';

/** mflux image generation strategy: builds a one-shot command invocation.
 *  Model selection follows env-pin semantics: opts.model takes precedence,
 *  falling back to AGENT_IMAGE_MODEL env var, then hardcoded default 'schnell'.
 *  Note: mflux has no safety checker, so disableSafetyChecker is a documented no-op. */
export const mfluxStrategy: GenStrategy = {
  kind: MediaKindEnum.Image as MediaKind,
  execMode: ExecModeEnum.OneShot as ExecMode,
  buildOneShot(prompt: string, outPath: string, opts: GenOpts) {
    const model = opts.model ?? process.env.AGENT_IMAGE_MODEL ?? 'schnell';
    const height = String(opts.height ?? 1024);
    const width = String(opts.width ?? 1024);

    return {
      cmd: 'mflux-generate',
      args: [
        '--model',
        model,
        '--steps',
        '4',
        '-q',
        '8',
        '--height',
        height,
        '--width',
        width,
        '--prompt',
        prompt,
        '--output',
        outPath,
      ],
    };
  },
};
