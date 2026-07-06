import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Which media venv a tool's binary lives in. Video is deliberately isolated
 *  from the (STT/image/TTS) media venv — see `scripts/setup-media.ts` for
 *  why: mlx-video's `mlx_vlm` dependency needs `transformers==5.5.0`, which
 *  conflicts with the media venv's own transformers version, so it gets its
 *  own venv rather than sharing one. */
export enum MediaVenv {
  Media = 'media',
  Video = 'video',
}

const DEFAULT_MEDIA_VENV = join(homedir(), '.cache/ai/media-venv');
const DEFAULT_VIDEO_VENV = join(homedir(), '.cache/ai/media-video-venv');

function venvDir(venv: MediaVenv): string {
  if (venv === MediaVenv.Video) {
    return process.env.AGENT_MEDIA_VIDEO_VENV ?? DEFAULT_VIDEO_VENV;
  }
  return process.env.AGENT_MEDIA_VENV ?? DEFAULT_MEDIA_VENV;
}

type ResolveDeps = {
  /** Injectable filesystem existence check; defaults to `existsSync`. Tests
   *  inject a fake so resolution is deterministic regardless of whether the
   *  venvs actually exist on the machine running them. */
  exists?: (p: string) => boolean;
};

/** Resolves a media CLI tool name to its installed venv binary when present,
 *  falling back to the bare tool name (PATH lookup) otherwise. Callers layer
 *  this under an explicit env-var override (`AGENT_STT_CMD` etc.) so the full
 *  precedence is: explicit env override > venv binary > bare PATH name. */
export function resolveMediaCmd(
  tool: string,
  venv: MediaVenv,
  deps: ResolveDeps = {},
): string {
  const exists = deps.exists ?? existsSync;
  const binPath = join(venvDir(venv), 'bin', tool);
  return exists(binPath) ? binPath : tool;
}
