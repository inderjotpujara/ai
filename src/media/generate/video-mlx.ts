import type { JobProgress } from '../types.ts';
import { ExecMode, MediaKind } from '../types.ts';
import type { GenOpts, GenStrategy } from './adapter.ts';

/** LTX video generation strategy via mlx-video: builds a one-shot command invocation.
 *  Configuration follows env-pin semantics:
 *  - cmd: AGENT_VIDEO_CMD env var, falls back to 'mlx_video.ltx_2.generate'
 *  - width: opts.width takes precedence, then defaults to 768
 *  - seconds: opts.seconds converted to frames (24 fps), defaults to 97 frames (~4s)
 *  - image: optional image conditioning input
 *  Note: mlx-video has no safety checker, so disableSafetyChecker is a
 *  documented no-op here (filter-free by construction, nothing to disable). */
export const ltxStrategy: GenStrategy = {
  kind: MediaKind.Video,
  execMode: ExecMode.OneShot,
  buildOneShot(prompt: string, outPath: string, opts: GenOpts) {
    const cmd = process.env.AGENT_VIDEO_CMD ?? 'mlx_video.ltx_2.generate';
    const frames = opts.seconds ? opts.seconds * 24 : 97;
    const width = opts.width ?? 768;

    return {
      cmd,
      args: [
        '--prompt',
        prompt,
        ...(opts.image ? ['--image', opts.image] : []),
        '-n',
        String(frames),
        '--width',
        String(width),
        '--output-path',
        outPath,
      ],
    };
  },
  parseProgress(line: string): JobProgress | undefined {
    const match = line.match(/step (\d+)\/(\d+)/);
    const current = match?.[1];
    const total = match?.[2];
    if (current === undefined || total === undefined) return undefined;

    const fraction = parseInt(current, 10) / parseInt(total, 10);

    return {
      fraction,
      message: line,
    };
  },
};
