import { mkdtempSync, readdirSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withWallClock } from '../../reliability/timeout.ts';
import type { SpawnFn } from '../../runtime/process-supervisor.ts';
import { ATTR, withFrameSampleSpan } from '../../telemetry/spans.ts';
import { defaultSpawn } from '../spawn.ts';
import type { MediaStore } from '../store.ts';
import { type MediaHandle, type MediaItem, MediaKind } from '../types.ts';

type SampleFramesDeps = {
  spawn?: SpawnFn;
  listFrames?: (dir: string) => string[];
  fps?: number;
  maxFrames?: number;
  longEdge?: number;
  /** Wall-clock cap on the ffmpeg subprocess. Env fallback-only
   *  (AGENT_MEDIA_TIMEOUT_MS); defaults to 10 minutes so a hung engine
   *  fails the turn instead of hanging it forever. */
  timeoutMs?: number;
};

function defaultListFrames(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .map((name) => join(dir, name));
}

/** Builds the ffmpeg args to sample a video down to a set of scaled frames. */
export function buildFfmpegArgs(
  input: string,
  outPattern: string,
  opts: { fps: number; maxFrames: number; longEdge: number },
): string[] {
  return [
    '-i',
    input,
    '-vf',
    `fps=${opts.fps},scale='min(${opts.longEdge},iw)':-1`,
    '-frames:v',
    String(opts.maxFrames),
    '-q:v',
    '3',
    outPattern,
  ];
}

/**
 * Samples a video into frames via ffmpeg (spawned as a subprocess), stores
 * each frame as an Image, and returns a single group MediaItem (kind Video)
 * whose `frames` lists the child image handles.
 */
export async function sampleFrames(
  videoPath: string,
  store: MediaStore,
  deps: SampleFramesDeps = {},
): Promise<MediaItem> {
  const spawn = deps.spawn ?? defaultSpawn;
  const listFrames = deps.listFrames ?? defaultListFrames;
  const fps = deps.fps ?? 1;
  const maxFrames = deps.maxFrames ?? 30;
  const longEdge = deps.longEdge ?? 768;
  const timeoutMs =
    deps.timeoutMs ?? (Number(process.env.AGENT_MEDIA_TIMEOUT_MS) || 600_000);

  const dir = mkdtempSync(join(tmpdir(), 'agent-frames-'));
  const outPattern = join(dir, 'frame_%04d.jpg');
  const args = buildFfmpegArgs(videoPath, outPattern, {
    fps,
    maxFrames,
    longEdge,
  });

  return withFrameSampleSpan({ fps }, async (span) => {
    const startedAt = Date.now();
    const child = spawn('ffmpeg', args);
    try {
      const item = await withWallClock(
        timeoutMs,
        () =>
          new Promise<MediaItem>((resolve, reject) => {
            child.onExit((code) => {
              if (code !== 0) {
                reject(new Error(`frame sampling failed (exit ${code})`));
                return;
              }
              storeFrames(store, listFrames(dir), dir)
                .then(resolve)
                .catch(reject);
            });
          }),
      );
      span.setAttributes({
        [ATTR.MEDIA_FRAMES_DURATION_MS]: Date.now() - startedAt,
        [ATTR.MEDIA_FRAMES_SAMPLED]: item.frames?.length ?? 0,
      });
      return item;
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        child.kill('SIGTERM');
      }
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {
        // best-effort cleanup; a leftover temp dir is not fatal
      });
    }
  });
}

async function storeFrames(
  store: MediaStore,
  framePaths: string[],
  dir: string,
): Promise<MediaItem> {
  const childHandles: MediaHandle[] = [];
  for (const framePath of framePaths) {
    const bytes = await readFile(framePath);
    const item = await store.put(MediaKind.Image, bytes, 'image/jpeg');
    childHandles.push(item.handle);
  }
  return store.registerGroup(childHandles, dir);
}
