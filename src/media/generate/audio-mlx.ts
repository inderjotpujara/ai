import type { ExecMode, MediaKind } from '../types.ts';
import {
  ExecMode as ExecModeEnum,
  MediaKind as MediaKindEnum,
} from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';

/** Default Kokoro TTS model id — the only voice engine with NO cloning
 *  capability (fixed preset voices), so it needs no clone-consent gate. */
export const DEFAULT_VOICE_MODEL = 'mlx-community/Kokoro-82M-bf16';

/** Resolves the voice model that will actually be used for a `generate_speech`
 *  call, following the same env-pin precedence `buildOneShot` uses below:
 *  `opts.model` > `AGENT_VOICE_MODEL` env var > the Kokoro default. Exported
 *  so callers (e.g. the `generate_speech` tool) can check
 *  `requiresCloneConsent` against the model that will actually run, without
 *  duplicating this precedence logic. */
export function resolveVoiceModel(opts: GenOpts): string {
  return opts.model ?? process.env.AGENT_VOICE_MODEL ?? DEFAULT_VOICE_MODEL;
}

/** Kokoro TTS audio generation strategy via mlx-audio: builds a one-shot command invocation.
 *  Configuration follows env-pin semantics:
 *  - cmd: AGENT_TTS_CMD env var, falls back to 'mlx_audio.tts.generate'
 *  - model: see `resolveVoiceModel`
 *  - voice: opts.voice takes precedence, then AGENT_VOICE env var,
 *           then hardcoded default 'af_heart'
 *  Note: mlx-audio has no safety checker, so disableSafetyChecker is a
 *  documented no-op here (filter-free by construction, nothing to disable). */
export const kokoroStrategy: GenStrategy = {
  kind: MediaKindEnum.Audio as MediaKind,
  execMode: ExecModeEnum.OneShot as ExecMode,
  buildOneShot(text: string, outPath: string, opts: GenOpts) {
    const cmd = process.env.AGENT_TTS_CMD ?? 'mlx_audio.tts.generate';
    const model = resolveVoiceModel(opts);
    const voice = opts.voice ?? process.env.AGENT_VOICE ?? 'af_heart';
    const base = outPath.replace(/\.wav$/, '');

    return {
      cmd,
      args: [
        '--model',
        model,
        '--text',
        text,
        '--voice',
        voice,
        '--file_prefix',
        base,
      ],
    };
  },
  outputPathFor(outPath: string): string {
    return `${outPath.replace(/\.wav$/, '')}_000.wav`;
  },
};
