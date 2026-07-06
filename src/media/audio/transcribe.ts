import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { withWallClock } from '../../reliability/timeout.ts';
import type { SpawnFn } from '../../runtime/process-supervisor.ts';
import { ATTR, withTranscribeSpan } from '../../telemetry/spans.ts';
import { MediaVenv, resolveMediaCmd } from '../cmd-resolve.ts';
import { defaultSpawn } from '../spawn.ts';

type TranscribeDeps = {
  spawn?: SpawnFn;
  readJson?: (p: string) => Promise<{ text: string }>;
  model?: string;
  outDir?: string;
  /** Wall-clock cap on the whisper subprocess. Env fallback-only
   *  (AGENT_MEDIA_TIMEOUT_MS); defaults to 10 minutes so a hung engine
   *  fails the turn instead of hanging it forever. */
  timeoutMs?: number;
  /** The mlx_whisper CLI binary. Env fallback-only (`AGENT_STT_CMD`); else
   *  resolved against the installed media venv (`resolveMediaCmd`), falling
   *  back further to the bare `mlx_whisper` name (PATH) if the venv isn't
   *  present. NOTE: `python3 -m mlx_whisper` does NOT work — the package has
   *  no `__main__`; the CLI entry point is the supported invocation. */
  cmd?: string;
};

const jsonPathFor = (audioPath: string, outDir: string): string => {
  const base = basename(audioPath, extname(audioPath));
  return join(outDir, `${base}.json`);
};

const defaultReadJson = async (p: string): Promise<{ text: string }> => {
  const raw = readFileSync(p, 'utf8');
  return JSON.parse(raw) as { text: string };
};

/** Transcribes an audio file to text via mlx_whisper (spawned as a subprocess). */
export async function transcribe(
  audioPath: string,
  deps: TranscribeDeps = {},
): Promise<string> {
  const spawn = deps.spawn ?? defaultSpawn;
  const model =
    deps.model ??
    process.env.AGENT_STT_MODEL ??
    'mlx-community/whisper-large-v3-turbo';
  const createdOutDir = deps.outDir === undefined;
  const outDir = deps.outDir ?? mkdtempSync(join(tmpdir(), 'agent-stt-'));
  const readJson = deps.readJson ?? defaultReadJson;
  const cmd =
    deps.cmd ??
    process.env.AGENT_STT_CMD ??
    resolveMediaCmd('mlx_whisper', MediaVenv.Media);
  const timeoutMs =
    deps.timeoutMs ?? (Number(process.env.AGENT_MEDIA_TIMEOUT_MS) || 600_000);

  const args = [
    audioPath,
    '--model',
    model,
    '--output-dir',
    outDir,
    '--output-format',
    'json',
  ];

  return withTranscribeSpan({ model }, async (span) => {
    const startedAt = Date.now();
    const child = spawn(cmd, args);
    try {
      const text = await withWallClock(
        timeoutMs,
        () =>
          new Promise<string>((resolve, reject) => {
            child.onExit((code) => {
              if (code !== 0) {
                reject(new Error(`transcription failed (exit ${code})`));
                return;
              }
              readJson(jsonPathFor(audioPath, outDir))
                .then((result) => resolve(result.text))
                .catch(reject);
            });
          }),
      );
      span.setAttributes({
        [ATTR.MEDIA_TRANSCRIBE_DURATION_MS]: Date.now() - startedAt,
        [ATTR.MEDIA_TRANSCRIBE_OUTCOME]: 'ok',
      });
      return text;
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        child.kill('SIGTERM');
      }
      span.setAttributes({
        [ATTR.MEDIA_TRANSCRIBE_DURATION_MS]: Date.now() - startedAt,
        [ATTR.MEDIA_TRANSCRIBE_OUTCOME]: 'failed',
      });
      throw err;
    } finally {
      if (createdOutDir) {
        await rm(outDir, { recursive: true, force: true }).catch(() => {
          // best-effort cleanup; a leftover temp dir is not fatal
        });
      }
    }
  });
}
