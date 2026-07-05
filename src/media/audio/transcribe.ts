import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import type { SpawnFn } from '../../runtime/process-supervisor.ts';
import { ATTR, withTranscribeSpan } from '../../telemetry/spans.ts';

type TranscribeDeps = {
  spawn?: SpawnFn;
  readJson?: (p: string) => Promise<{ text: string }>;
  model?: string;
  outDir?: string;
};

const defaultSpawn: SpawnFn = (cmd, args) => {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return {
    pid: proc.pid,
    kill: (sig) => proc.kill(sig as never),
    onExit: (cb) => {
      proc.exited.then((code) => cb(code));
    },
  };
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
  const outDir = deps.outDir ?? mkdtempSync(join(tmpdir(), 'agent-stt-'));
  const readJson = deps.readJson ?? defaultReadJson;

  const args = [
    '-m',
    'mlx_whisper',
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
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const child = spawn('python3', args);
        child.onExit((code) => {
          if (code !== 0) {
            reject(new Error(`transcription failed (exit ${code})`));
            return;
          }
          readJson(jsonPathFor(audioPath, outDir))
            .then((result) => resolve(result.text))
            .catch(reject);
        });
      });
      span.setAttributes({
        [ATTR.MEDIA_TRANSCRIBE_DURATION_MS]: Date.now() - startedAt,
        [ATTR.MEDIA_TRANSCRIBE_OUTCOME]: 'ok',
      });
      return text;
    } catch (err) {
      span.setAttributes({
        [ATTR.MEDIA_TRANSCRIBE_DURATION_MS]: Date.now() - startedAt,
        [ATTR.MEDIA_TRANSCRIBE_OUTCOME]: 'failed',
      });
      throw err;
    }
  });
}
