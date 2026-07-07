import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

export const DEFAULT_VOICE_MODEL = 'sherpa-onnx-moonshine-tiny-en-int8';

/** Cache dir for downloaded voice models. Env AGENT_VOICE_DIR overrides. */
export function voiceCacheDir(env: Env = process.env): string {
  return env.AGENT_VOICE_DIR ?? join(homedir(), '.cache', 'ai', 'voice');
}

/**
 * Resolves the moonshine model directory. Precedence:
 * explicit AGENT_VOICE_STT_MODEL (absolute) > <cacheDir>/<DEFAULT_VOICE_MODEL>.
 */
export function resolveVoiceModel(env: Env = process.env): string {
  if (env.AGENT_VOICE_STT_MODEL) return env.AGENT_VOICE_STT_MODEL;
  return join(voiceCacheDir(env), DEFAULT_VOICE_MODEL);
}

/** ffmpeg binary. Env AGENT_FFMPEG_CMD overrides; else bare PATH `ffmpeg`. */
export function ffmpegCmd(env: Env = process.env): string {
  return env.AGENT_FFMPEG_CMD ?? 'ffmpeg';
}
