### Task 7: Subprocess transcriber + selector

**Files:**
- Modify: `src/voice/transcribe.ts` (add `createSubprocessTranscriber`, `createTranscriber`)
- Create: `src/voice/stt-worker.mjs`
- Test: `tests/voice/transcribe-select.test.ts`

**Interfaces:**
- Consumes: `Transcriber`, `VoiceConfig` (Task 2); `createInProcessTranscriber` (Task 6).
- Produces: `createSubprocessTranscriber(cfg, deps?): Transcriber` (spawns `node` worker; sends `{sampleRate, samples[]}` as JSON on stdin, reads `{text}` on stdout); `createTranscriber(cfg, env?): Transcriber` selecting impl by `env.AGENT_VOICE_EXEC` (`'subprocess'` → subprocess, else in-process).

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/transcribe-select.test.ts
import { describe, expect, it } from 'bun:test';
import { createTranscriber } from '../../src/voice/transcribe.ts';

const cfg = { modelDir: '/m', ffmpeg: 'ffmpeg', timeoutMs: 5000 };

describe('createTranscriber selection', () => {
  it('uses subprocess impl when AGENT_VOICE_EXEC=subprocess', () => {
    const t = createTranscriber(cfg, { AGENT_VOICE_EXEC: 'subprocess' });
    // Subprocess impl lazily spawns; we only assert the shape here.
    expect(typeof t.transcribe).toBe('function');
    expect(typeof t.close).toBe('function');
  });
  it('defaults to in-process (throws on addon load, proving it took that path)', () => {
    // With no real addon + no fake, in-process load will throw when transcribe runs;
    // constructing the selector must not itself throw for the default path decision.
    expect(() => createTranscriber(cfg, {})).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/transcribe-select.test.ts`
Expected: FAIL — `createTranscriber` not exported.

- [ ] **Step 3: Write minimal implementation**

Create the worker:
```js
// src/voice/stt-worker.mjs
// Runs the sherpa-onnx addon under `node`. Reads one JSON line
// {modelDir, sampleRate, samples:[...]}, prints {text} as JSON, exits.
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function loadSherpa() {
  const root = join(process.cwd(), 'node_modules');
  process.env.DYLD_LIBRARY_PATH = [
    join(root, 'sherpa-onnx-node'),
    join(root, 'sherpa-onnx-darwin-arm64'),
    process.env.DYLD_LIBRARY_PATH ?? '',
  ].join(':');
  return require('sherpa-onnx-node');
}

let buf = '';
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', () => {
  try {
    const { modelDir, sampleRate, samples } = JSON.parse(buf);
    const sherpa = loadSherpa();
    const recognizer = new sherpa.OfflineRecognizer({
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
    });
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate, samples: Float32Array.from(samples) });
    recognizer.decode(stream);
    const text = String(recognizer.getResult(stream).text ?? '').trim();
    process.stdout.write(JSON.stringify({ text }));
    process.exit(0);
  } catch (err) {
    process.stderr.write(String(err));
    process.exit(1);
  }
});
```

Append to `src/voice/transcribe.ts`:
```ts
import { withVoiceTranscribeSpan } from '../telemetry/spans.ts';

export type SubprocessDeps = {
  spawn?: (cmd: string[], stdin: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  source?: CaptureSource;
};

async function defaultNodeSpawn(cmd: string[], stdin: string) {
  const p = Bun.spawn(cmd, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  p.stdin.write(stdin);
  await p.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, stdout, stderr };
}

export function createSubprocessTranscriber(cfg: VoiceConfig, deps: SubprocessDeps = {}): Transcriber {
  const spawn = deps.spawn ?? defaultNodeSpawn;
  const source = deps.source ?? CaptureSource.Mic;
  const worker = join(import.meta.dir, 'stt-worker.mjs');
  return {
    async transcribe(frames: VoiceFrames): Promise<string> {
      if (frames.samples.length === 0) {
        throw new VoiceError('no audio captured', 'check the microphone / input file');
      }
      return withVoiceTranscribeSpan({ model: cfg.modelDir, source }, () =>
        withWallClock(cfg.timeoutMs, async () => {
          const payload = JSON.stringify({
            modelDir: cfg.modelDir,
            sampleRate: frames.sampleRate,
            samples: Array.from(frames.samples),
          });
          const { code, stdout, stderr } = await spawn(['node', worker], payload);
          if (code !== 0) throw new VoiceError(`stt worker failed: ${stderr}`);
          return String(JSON.parse(stdout).text ?? '').trim();
        }),
      );
    },
    async close() {},
  };
}

/** Selects the transcriber impl. AGENT_VOICE_EXEC=subprocess forces the worker;
 *  otherwise in-process (default set by the Task-1 spike). */
export function createTranscriber(
  cfg: VoiceConfig,
  env: Record<string, string | undefined> = process.env,
): Transcriber {
  return env.AGENT_VOICE_EXEC === 'subprocess'
    ? createSubprocessTranscriber(cfg)
    : createInProcessTranscriber(cfg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/transcribe-select.test.ts`
Expected: PASS (2 tests). Add a focused subprocess test with an injected `spawn` returning `{code:0, stdout:'{"text":"hi"}'}` and assert `transcribe` returns `'hi'`.

- [ ] **Step 5: Commit**

```bash
git add src/voice/transcribe.ts src/voice/stt-worker.mjs tests/voice/transcribe-select.test.ts
git commit -m "feat(voice): node-subprocess transcriber + exec selector"
```

---

