import type { ExecMode, MediaKind } from '../types.ts';
import {
  ExecMode as ExecModeEnum,
  MediaKind as MediaKindEnum,
} from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';

/** Kokoro TTS audio generation strategy via mlx-audio: builds a one-shot command invocation.
 *  Configuration follows env-pin semantics:
 *  - cmd: AGENT_TTS_CMD env var, falls back to 'mlx_audio.tts.generate'
 *  - model: opts.model takes precedence, then AGENT_VOICE_MODEL env var,
 *           then hardcoded default 'mlx-community/Kokoro-82M-bf16'
 *  - voice: opts.voice takes precedence, then AGENT_VOICE env var,
 *           then hardcoded default 'af_heart' */
export const kokoroStrategy: GenStrategy = {
  kind: MediaKindEnum.Audio as MediaKind,
  execMode: ExecModeEnum.OneShot as ExecMode,
  buildOneShot(text: string, outPath: string, opts: GenOpts) {
    const cmd = process.env.AGENT_TTS_CMD ?? 'mlx_audio.tts.generate';
    const model =
      opts.model ??
      process.env.AGENT_VOICE_MODEL ??
      'mlx-community/Kokoro-82M-bf16';
    const voice = opts.voice ?? process.env.AGENT_VOICE ?? 'af_heart';

    return {
      cmd,
      args: [
        '--model',
        model,
        '--text',
        text,
        '--voice',
        voice,
        '--output_path',
        outPath,
      ],
    };
  },
};
