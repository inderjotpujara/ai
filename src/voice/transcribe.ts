import { join } from 'node:path';
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

/** Sets the dyld path the addon needs, then loads it (default loader). */
function defaultLoadSherpa(): unknown {
  const root = join(process.cwd(), 'node_modules');
  process.env.DYLD_LIBRARY_PATH = [
    join(root, 'sherpa-onnx-node'),
    join(root, 'sherpa-onnx-darwin-arm64'),
    process.env.DYLD_LIBRARY_PATH ?? '',
  ].join(':');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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
            const text = await withWallClock(cfg.timeoutMs, async () => {
              const stream = recognizer.createStream();
              try {
                stream.acceptWaveform?.({
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
