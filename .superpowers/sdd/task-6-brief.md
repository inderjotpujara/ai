### Task 6: In-process transcriber (sherpa-onnx addon)

**Files:**
- Create: `src/voice/transcribe.ts`
- Test: `tests/voice/transcribe.test.ts`

**Interfaces:**
- Consumes: `VoiceFrames`, `VoiceConfig`, `Transcriber`, `VoiceError` (Task 2); `withVoiceTranscribeSpan` (Task 5); `withWallClock` from `src/reliability/timeout.ts`; `CaptureSource`.
- Produces: `createInProcessTranscriber(cfg, deps?): Transcriber`, where `deps.loadSherpa?: () => SherpaModule` is injectable for tests. `SherpaModule` shape: `{ OfflineRecognizer: new (config) => { createStream(): Stream; decode(s): void; getResult(s): { text: string }; }, ... }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/transcribe.test.ts
import { describe, expect, it } from 'bun:test';
import { createInProcessTranscriber } from '../../src/voice/transcribe.ts';
import { CaptureSource } from '../../src/voice/types.ts';

function fakeSherpa(text: string) {
  return () => ({
    OfflineRecognizer: class {
      createStream() {
        return { free() {} };
      }
      acceptWaveform() {}
      decode() {}
      getResult() {
        return { text };
      }
    },
  });
}

const cfg = { modelDir: '/m', ffmpeg: 'ffmpeg', timeoutMs: 5000 };

describe('createInProcessTranscriber', () => {
  it('returns recognized text for a buffer', async () => {
    const t = createInProcessTranscriber(cfg, {
      loadSherpa: fakeSherpa('hello world'),
      source: CaptureSource.File,
    });
    const text = await t.transcribe({ samples: new Float32Array(16000), sampleRate: 16000 });
    expect(text).toBe('hello world');
    await t.close();
  });
  it('throws VoiceError with a hint on empty samples', async () => {
    const t = createInProcessTranscriber(cfg, {
      loadSherpa: fakeSherpa(''),
      source: CaptureSource.Mic,
    });
    await expect(
      t.transcribe({ samples: new Float32Array(0), sampleRate: 16000 }),
    ).rejects.toThrow(/no audio/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/transcribe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

> NOTE: the sherpa-onnx `OfflineRecognizer` config nesting (`modelConfig.moonshine.{preprocessor,encoder,uncachedDecoder,cachedDecoder}`, `modelConfig.tokens`) must be confirmed against the installed `node_modules/sherpa-onnx-node` examples at implementation time — set the paths from `cfg.modelDir`.

```ts
// src/voice/transcribe.ts
import { join } from 'node:path';
import { withWallClock } from '../reliability/timeout.ts';
import { withVoiceTranscribeSpan } from '../telemetry/spans.ts';
import { CaptureSource, type Transcriber, type VoiceConfig, VoiceError, type VoiceFrames } from './types.ts';

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

export function createInProcessTranscriber(cfg: VoiceConfig, deps: InProcessDeps = {}): Transcriber {
  const load = deps.loadSherpa ?? defaultLoadSherpa;
  const source = deps.source ?? CaptureSource.Mic;
  // biome-ignore lint/suspicious/noExplicitAny: addon has no types
  const sherpa = load() as any;
  const recognizer = new sherpa.OfflineRecognizer(moonshineConfig(cfg.modelDir));

  return {
    async transcribe(frames: VoiceFrames): Promise<string> {
      if (frames.samples.length === 0) {
        throw new VoiceError('no audio captured', 'check the microphone / input file');
      }
      return withVoiceTranscribeSpan({ model: cfg.modelDir, source }, () =>
        withWallClock(cfg.timeoutMs, async () => {
          const stream = recognizer.createStream();
          try {
            stream.acceptWaveform({ sampleRate: frames.sampleRate, samples: frames.samples });
            recognizer.decode(stream);
            return String(recognizer.getResult(stream).text ?? '').trim();
          } finally {
            stream.free?.();
          }
        }),
      );
    },
    async close() {
      recognizer.free?.();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/transcribe.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/transcribe.ts tests/voice/transcribe.test.ts
git commit -m "feat(voice): in-process sherpa-onnx transcriber (buffer to text)"
```

---

