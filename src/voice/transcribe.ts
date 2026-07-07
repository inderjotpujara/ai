import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { withWallClock } from '../reliability/timeout.ts';
import { ATTR, withVoiceTranscribeSpan } from '../telemetry/spans.ts';
import {
  CaptureSource,
  type Transcriber,
  type VoiceConfig,
  VoiceError,
  type VoiceFrames,
  VoiceOutcome,
} from './types.ts';

const require = createRequire(import.meta.url);

/**
 * Resolves the sherpa-onnx dylib directories from the addon's INSTALLED
 * location (via `require.resolve`), never from `process.cwd()`. cwd-relative
 * resolution would (a) load an attacker-controlled dylib if voice is ever run
 * from an untrusted cwd that happens to contain its own
 * `node_modules/sherpa-onnx-darwin-arm64`, and (b) break voice outright
 * whenever the process launches from anywhere other than the repo root.
 */
function resolveSherpaDyldDirs(): string[] {
  const resolved = require.resolve('sherpa-onnx-node');
  const marker = `${sep}node_modules${sep}sherpa-onnx-node${sep}`;
  const idx = resolved.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      `could not locate the sherpa-onnx-node install root from ${resolved}`,
    );
  }
  const nodeModulesRoot = resolved.slice(0, idx + `${sep}node_modules`.length);
  return [
    join(nodeModulesRoot, 'sherpa-onnx-node'),
    join(nodeModulesRoot, 'sherpa-onnx-darwin-arm64'),
  ];
}

/** Sets the dyld path the addon needs, then loads it (default loader). */
function defaultLoadSherpa(): unknown {
  process.env.DYLD_LIBRARY_PATH = [
    ...resolveSherpaDyldDirs(),
    process.env.DYLD_LIBRARY_PATH ?? '',
  ].join(':');
  return require('sherpa-onnx-node');
}

export type InProcessDeps = {
  loadSherpa?: () => unknown;
  source?: CaptureSource;
};

/** Builds an OfflineRecognizer config from a moonshine model directory. */
function moonshineConfig(modelDir: string) {
  return {
    modelConfig: {
      moonshine: {
        preprocessor: join(modelDir, 'preprocess.onnx'),
        encoder: join(modelDir, 'encode.int8.onnx'),
        uncachedDecoder: join(modelDir, 'uncached_decode.int8.onnx'),
        cachedDecoder: join(modelDir, 'cached_decode.int8.onnx'),
      },
      tokens: join(modelDir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
    },
  };
}

export function createInProcessTranscriber(
  cfg: VoiceConfig,
  deps: InProcessDeps = {},
): Transcriber {
  const load = deps.loadSherpa ?? defaultLoadSherpa;
  const source = deps.source ?? CaptureSource.Mic;
  // biome-ignore lint/suspicious/noExplicitAny: addon has no types
  const sherpa = load() as any;
  const recognizer = new sherpa.OfflineRecognizer(
    moonshineConfig(cfg.modelDir),
  );

  return {
    async transcribe(frames: VoiceFrames): Promise<string> {
      if (frames.samples.length === 0) {
        throw new VoiceError(
          'no audio captured',
          'check the microphone / input file',
        );
      }
      return withVoiceTranscribeSpan(
        { model: cfg.modelDir, source },
        async (span) => {
          const startedAt = Date.now();
          try {
            // NOTE: recognizer.decode() below is a synchronous native call
            // that blocks the JS event loop, so this withWallClock timer
            // cannot fire until decode returns — the timeout is NOT
            // enforced on this path. Use AGENT_VOICE_EXEC=subprocess when
            // an enforceable timeout matters (see docs/architecture.md §23).
            const text = await withWallClock(cfg.timeoutMs, async () => {
              const stream = recognizer.createStream();
              try {
                stream.acceptWaveform({
                  sampleRate: frames.sampleRate,
                  samples: frames.samples,
                });
                recognizer.decode(stream);
                return String(recognizer.getResult(stream).text ?? '').trim();
              } finally {
                stream.free?.();
              }
            });
            span.setAttribute(
              ATTR.VOICE_AUDIO_SECONDS,
              frames.samples.length / frames.sampleRate,
            );
            span.setAttribute(ATTR.VOICE_DURATION_MS, Date.now() - startedAt);
            span.setAttribute(ATTR.VOICE_OUTCOME, VoiceOutcome.Ok);
            return text;
          } catch (err) {
            span.setAttribute(
              ATTR.VOICE_AUDIO_SECONDS,
              frames.samples.length / frames.sampleRate,
            );
            span.setAttribute(ATTR.VOICE_DURATION_MS, Date.now() - startedAt);
            span.setAttribute(
              ATTR.VOICE_OUTCOME,
              (err as Error).message === 'timeout'
                ? VoiceOutcome.Timeout
                : VoiceOutcome.Failed,
            );
            throw err;
          }
        },
      );
    },
    async close() {
      recognizer.free?.();
    },
  };
}

export type SpawnHandle = {
  kill(): void;
  done: Promise<{ code: number; stdout: string; stderr: string }>;
};

export type SpawnFn = (cmd: string[], stdin: string) => SpawnHandle;

export type SubprocessDeps = {
  spawn?: SpawnFn;
  source?: CaptureSource;
};

function defaultNodeSpawn(cmd: string[], stdin: string): SpawnHandle {
  const proc = Bun.spawn(cmd, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const done = (async () => {
    proc.stdin.write(stdin);
    await proc.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  })();
  return { kill: () => proc.kill('SIGTERM'), done };
}

/** Transcribes by shelling out to a `node` worker running the sherpa-onnx
 *  addon (`stt-worker.mjs`). Robust fallback for when the addon can't be
 *  loaded in-process (e.g. under Bun on a given platform/version). */
export function createSubprocessTranscriber(
  cfg: VoiceConfig,
  deps: SubprocessDeps = {},
): Transcriber {
  const spawn = deps.spawn ?? defaultNodeSpawn;
  const source = deps.source ?? CaptureSource.Mic;
  const worker = join(import.meta.dir, 'stt-worker.mjs');
  return {
    async transcribe(frames: VoiceFrames): Promise<string> {
      if (frames.samples.length === 0) {
        throw new VoiceError(
          'no audio captured',
          'check the microphone / input file',
        );
      }
      return withVoiceTranscribeSpan(
        { model: cfg.modelDir, source },
        async (span) => {
          const startedAt = Date.now();
          const payload = JSON.stringify({
            modelDir: cfg.modelDir,
            sampleRate: frames.sampleRate,
            samples: Array.from(frames.samples),
          });
          const { kill, done } = spawn(['node', worker], payload);
          try {
            const { code, stdout, stderr } = await withWallClock(
              cfg.timeoutMs,
              () => done,
            );
            if (code !== 0) {
              throw new VoiceError(`stt worker failed: ${stderr}`);
            }
            const text = String(JSON.parse(stdout).text ?? '').trim();
            span.setAttribute(
              ATTR.VOICE_AUDIO_SECONDS,
              frames.samples.length / frames.sampleRate,
            );
            span.setAttribute(ATTR.VOICE_DURATION_MS, Date.now() - startedAt);
            span.setAttribute(ATTR.VOICE_OUTCOME, VoiceOutcome.Ok);
            return text;
          } catch (err) {
            if (err instanceof Error && err.message === 'timeout') {
              kill();
              // withWallClock already lost the race against `done`; a later
              // rejection/resolution from the killed subprocess must not
              // become an unhandled rejection.
              done.catch(() => {});
            }
            span.setAttribute(
              ATTR.VOICE_AUDIO_SECONDS,
              frames.samples.length / frames.sampleRate,
            );
            span.setAttribute(ATTR.VOICE_DURATION_MS, Date.now() - startedAt);
            span.setAttribute(
              ATTR.VOICE_OUTCOME,
              (err as Error).message === 'timeout'
                ? VoiceOutcome.Timeout
                : VoiceOutcome.Failed,
            );
            throw err;
          }
        },
      );
    },
    async close() {},
  };
}

/** Selects the transcriber impl. `AGENT_VOICE_EXEC=subprocess` forces the
 *  node worker; otherwise in-process (default set by the Task-1 spike, which
 *  confirmed the sherpa-onnx addon loads fine under Bun). */
export function createTranscriber(
  cfg: VoiceConfig,
  env: Record<string, string | undefined> = process.env,
): Transcriber {
  return env.AGENT_VOICE_EXEC === 'subprocess'
    ? createSubprocessTranscriber(cfg)
    : createInProcessTranscriber(cfg);
}
