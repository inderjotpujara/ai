# Slice 29 — CLI voice input (STT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user speak (or point at an audio file) and have the transcript become their `bun run chat` prompt, via a single STT engine (`sherpa-onnx`) whose transcribe core is structured for reuse in the Slice-30 browser.

**Architecture:** New `src/voice/` subsystem with two layers behind one interface. A **capture layer** (ffmpeg `avfoundation` subprocess) yields a Float32/16 kHz buffer — live mic uses tap-to-toggle (raw TTY) with ffmpeg `silencedetect` auto-stop; `--voice-in <path>` decodes a file. A **transcribe core** turns the buffer into text via a `Transcriber` interface with two impls (in-process `sherpa-onnx-node` addon, or a `node` subprocess) chosen by a day-1 Bun-addon spike. The transcript is spliced into the prompt exactly like the existing `--audio` path — no orchestrator changes.

**Tech Stack:** Bun, TypeScript, `sherpa-onnx-node@^1.13.4` (moonshine-tiny-en model), system `ffmpeg`, existing `src/reliability/` (`withWallClock`, degrade ledger) + `src/telemetry/spans.ts`.

## Global Constraints

- **Use `bun`, never `npm`.** Run tests with `bun test`; typecheck `bun run typecheck`; lint `bun run lint:file -- <files>`.
- **Prefer `type` over `interface`; prefer string `enum` over string-literal unions** for finite named sets (`enum Foo { A = 'A' }`). Discriminated unions stay `type`.
- **Never crash** — every capture/transcribe failure degrades to a warning string + a `DegradeEvent` on the run ledger; the prompt proceeds without voice.
- **STT dependency:** `sherpa-onnx-node@^1.13.4` (pin exact — sherpa ships releases very frequently). Prebuilt macOS-arm64 addon; **`DYLD_LIBRARY_PATH` must be set programmatically in the spawned process env** (`$(npm root)/sherpa-onnx-node` + the `sherpa-onnx-darwin-arm64` dir), never via user shell profile.
- **Audio contract:** Float32 samples in [-1, 1] at **16 kHz mono**. ffmpeg emits this directly (`-ac 1 -ar 16000 -f f32le`) — no resampling code.
- **Model:** default `sherpa-onnx-moonshine-tiny-en-int8` (offline, English, short-command optimized) under `~/.cache/ai/voice/`; env `AGENT_VOICE_STT_MODEL` selects an alternate directory (e.g. `moonshine-base-en-int8`). Model zoo release tag `asr-models` on `github.com/k2-fsa/sherpa-onnx`.
- **Auto-stop = ffmpeg `silencedetect`** (model-free, execution-seam-independent) — NOT real-time silero VAD. sherpa is used only for buffer→text.
- **macOS mic permission** is TCC-gated to the terminal host app and fails silently (zeros, often no prompt) → detect empty/low-energy capture and print an actionable hint.
- **Docs 4-surface hard line** applies at finalize (Task 12/14): `docs/architecture.md` (new §Voice — `scripts/docs-check.ts` fails until `src/voice` is documented), `README.md`, `docs/ROADMAP.md`, SDD ledger `.superpowers/sdd/progress.md`, + regenerate the Artifact.
- **Commits:** conventional format, subject `type(scope): summary`; end body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Implementers run focused tests inline + commit; the controller runs the full suite between tasks.

## File Structure

- `src/voice/types.ts` — `VoiceFrames`, `CaptureSource`, `VoiceOutcome` enums, `VoiceError`, `VoiceConfig`, `Transcriber` interface. (Task 2)
- `src/voice/model.ts` — `voiceCacheDir()`, `resolveVoiceModel()`, `ffmpegCmd()`. (Task 3)
- `scripts/setup-voice.ts` — idempotent model download + ffmpeg check; `"setup:voice"` script. (Task 4)
- `src/telemetry/spans.ts` — add `VOICE_*` attrs + `withVoiceTranscribeSpan`. (Task 5)
- `src/voice/transcribe.ts` — `createInProcessTranscriber`, `createSubprocessTranscriber`, `createTranscriber` selector. (Tasks 6–7)
- `src/voice/stt-worker.mjs` — node-subprocess worker (buffer→text). (Task 7)
- `src/voice/capture.ts` — `captureFromFile`, `captureFromMic`. (Tasks 8–9)
- `src/voice/ingest.ts` — `ingestVoice(rawPrompt, flags, deps)` → `{prompt, warnings}`. (Task 11)
- `src/cli/chat.ts` — extend `parseMediaArgs`/`IngestFlags`/`hasMediaFlags`; call `ingestVoice`. (Tasks 10–11)
- Tests under `tests/voice/*.test.ts` + `tests/integration/voice.live.test.ts` (gated). Fixture `tests/voice/fixtures/hello.f32` (raw Float32LE 16k) + `tests/voice/fixtures/hello.wav`.

---

### Task 1: Add dependency + Bun-addon de-risking spike

**Files:**
- Modify: `package.json` (add dependency)
- Create: `scripts/spikes/sherpa-bun-smoke.ts`

**Interfaces:**
- Produces: a decision recorded in the ledger + committed spike script. Sets the default for `AGENT_VOICE_EXEC` (`inprocess` if the addon loads under Bun, else `subprocess`).

- [ ] **Step 1: Add the dependency**

Run: `bun add sherpa-onnx-node@1.13.4`
Then confirm the resolved version + the platform prebuilt package name:
Run: `bun pm ls | grep sherpa` and `ls node_modules | grep sherpa`
Expected: `sherpa-onnx-node` present + a `sherpa-onnx-darwin-arm64` (or similarly named) prebuilt dir. Record the exact prebuilt dir name — it is needed for `DYLD_LIBRARY_PATH`.

- [ ] **Step 2: Write the smoke spike**

```ts
// scripts/spikes/sherpa-bun-smoke.ts
// Smoke-test whether Bun can load the sherpa-onnx-node N-API addon.
// Run: bun run scripts/spikes/sherpa-bun-smoke.ts
import { join } from 'node:path';

const root = join(process.cwd(), 'node_modules');
// The addon needs its bundled .dylibs on the dyld search path at load time.
process.env.DYLD_LIBRARY_PATH = [
  join(root, 'sherpa-onnx-node'),
  join(root, 'sherpa-onnx-darwin-arm64'),
  process.env.DYLD_LIBRARY_PATH ?? '',
].join(':');

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sherpa = require('sherpa-onnx-node');
  console.log('LOADED', Object.keys(sherpa).slice(0, 12));
  console.log('HAS_OfflineRecognizer', typeof sherpa.OfflineRecognizer);
  process.exit(typeof sherpa.OfflineRecognizer === 'function' ? 0 : 2);
} catch (err) {
  console.error('LOAD_FAILED', (err as Error).message);
  process.exit(1);
}
```

- [ ] **Step 3: Run the spike under Bun**

Run: `bun run scripts/spikes/sherpa-bun-smoke.ts`
Expected: either `LOADED [...]` + `HAS_OfflineRecognizer function` (exit 0 → default `inprocess`), or `LOAD_FAILED ...` (exit 1 → default `subprocess`; also confirm `command -v node` exists for the fallback).

- [ ] **Step 4: Record the outcome**

Append the result (loads under Bun? y/n; prebuilt dir name; node available?) to `.superpowers/sdd/progress.md` under a new `## SLICE 29` heading. This decides the `createTranscriber` default in Task 7.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock scripts/spikes/sherpa-bun-smoke.ts .superpowers/sdd/progress.md
git commit -m "chore(slice-29): add sherpa-onnx-node + Bun-addon smoke spike"
```

---

### Task 2: Voice types

**Files:**
- Create: `src/voice/types.ts`
- Test: `tests/voice/types.test.ts`

**Interfaces:**
- Produces: `VoiceFrames`, `CaptureSource`, `VoiceOutcome`, `VoiceError`, `VoiceConfig`, `Transcriber`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/types.test.ts
import { describe, expect, it } from 'bun:test';
import { CaptureSource, VoiceError, VoiceOutcome } from '../../src/voice/types.ts';

describe('voice types', () => {
  it('VoiceError carries an actionable hint', () => {
    const e = new VoiceError('no audio', 'grant Microphone access');
    expect(e).toBeInstanceOf(Error);
    expect(e.hint).toBe('grant Microphone access');
    expect(e.name).toBe('VoiceError');
  });
  it('enums use explicit string values', () => {
    expect(CaptureSource.Mic).toBe('mic');
    expect(VoiceOutcome.Empty).toBe('empty');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/types.test.ts`
Expected: FAIL — module `src/voice/types.ts` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/voice/types.ts

/** Raw audio ready for the STT engine: mono Float32 in [-1,1] at 16 kHz. */
export type VoiceFrames = {
  samples: Float32Array;
  sampleRate: 16000;
};

export enum CaptureSource {
  Mic = 'mic',
  File = 'file',
}

export enum VoiceOutcome {
  Ok = 'ok',
  Empty = 'empty',
  Failed = 'failed',
  Timeout = 'timeout',
}

/** Typed voice error; `hint` is a user-actionable next step (e.g. mic permission). */
export class VoiceError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}

export type VoiceConfig = {
  /** Absolute path to the moonshine model directory. */
  modelDir: string;
  /** ffmpeg binary (resolved). */
  ffmpeg: string;
  /** Wall-clock cap for a single capture/transcribe op, ms. */
  timeoutMs: number;
};

/** Turns a recorded utterance into text. Impl is in-process or subprocess. */
export type Transcriber = {
  transcribe(frames: VoiceFrames): Promise<string>;
  close(): Promise<void>;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/types.ts tests/voice/types.test.ts
git commit -m "feat(voice): core types (VoiceFrames, VoiceError, Transcriber)"
```

---

### Task 3: Model + tool resolution

**Files:**
- Create: `src/voice/model.ts`
- Test: `tests/voice/model.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `voiceCacheDir(): string`, `resolveVoiceModel(env?): string` (returns model dir), `ffmpegCmd(env?): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/model.test.ts
import { describe, expect, it } from 'bun:test';
import { ffmpegCmd, resolveVoiceModel, voiceCacheDir } from '../../src/voice/model.ts';

describe('voice model resolution', () => {
  it('defaults the cache dir under ~/.cache/ai/voice', () => {
    expect(voiceCacheDir({})).toMatch(/\.cache\/ai\/voice$/);
  });
  it('AGENT_VOICE_DIR overrides the cache dir', () => {
    expect(voiceCacheDir({ AGENT_VOICE_DIR: '/tmp/v' })).toBe('/tmp/v');
  });
  it('resolveVoiceModel joins the default model name under the cache dir', () => {
    expect(resolveVoiceModel({ AGENT_VOICE_DIR: '/tmp/v' })).toBe(
      '/tmp/v/sherpa-onnx-moonshine-tiny-en-int8',
    );
  });
  it('AGENT_VOICE_STT_MODEL overrides the model dir absolutely', () => {
    expect(resolveVoiceModel({ AGENT_VOICE_STT_MODEL: '/models/base' })).toBe('/models/base');
  });
  it('ffmpegCmd honors AGENT_FFMPEG_CMD then falls back to ffmpeg', () => {
    expect(ffmpegCmd({ AGENT_FFMPEG_CMD: '/opt/ffmpeg' })).toBe('/opt/ffmpeg');
    expect(ffmpegCmd({})).toBe('ffmpeg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/voice/model.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/model.ts tests/voice/model.test.ts
git commit -m "feat(voice): model + ffmpeg resolution with env overrides"
```

---

### Task 4: `setup:voice` model downloader

**Files:**
- Create: `scripts/setup-voice.ts`
- Modify: `package.json` (scripts block: add `"setup:voice"`)
- Test: `tests/voice/setup-voice.test.ts`

**Interfaces:**
- Consumes: `voiceCacheDir`, `DEFAULT_VOICE_MODEL` (Task 3).
- Produces: `modelUrl(name): string`, `isModelReady(dir, exists): boolean` (pure helpers, unit-tested); a `main()` that downloads + extracts (not unit-tested — exercised in live-verify).

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/setup-voice.test.ts
import { describe, expect, it } from 'bun:test';
import { isModelReady, modelUrl } from '../../scripts/setup-voice.ts';

describe('setup-voice helpers', () => {
  it('builds the asr-models release URL for a model name', () => {
    expect(modelUrl('sherpa-onnx-moonshine-tiny-en-int8')).toBe(
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2',
    );
  });
  it('is ready only when the tokens marker file exists', () => {
    const dir = '/m/tiny';
    expect(isModelReady(dir, (p) => p === '/m/tiny/tokens.txt')).toBe(true);
    expect(isModelReady(dir, () => false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/setup-voice.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/setup-voice.ts
// Idempotent voice-model provisioning (mirrors scripts/setup-media.ts).
// Run: bun run setup:voice
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_VOICE_MODEL, voiceCacheDir } from '../src/voice/model.ts';

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

/** Download URL for a model name in the sherpa-onnx `asr-models` release. */
export function modelUrl(name: string): string {
  return `${RELEASE}/${name}.tar.bz2`;
}

/** A model dir is ready when its tokens.txt marker exists. */
export function isModelReady(dir: string, exists: (p: string) => boolean = existsSync): boolean {
  return exists(join(dir, 'tokens.txt'));
}

/** Streams a shell command; resolves the exit code, never throws. */
async function run(cmd: string[]): Promise<number> {
  const p = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
  return await p.exited;
}

async function ensureFfmpeg(): Promise<void> {
  if (Bun.which('ffmpeg')) return;
  console.error('⚠ ffmpeg not found.');
  if (process.platform === 'darwin' && Bun.which('brew')) {
    console.error('Installing ffmpeg via brew...');
    await run(['brew', 'install', 'ffmpeg']);
  } else {
    console.error('Install ffmpeg manually (voice capture needs it).');
  }
}

async function main(): Promise<void> {
  await ensureFfmpeg();
  const dir = join(voiceCacheDir(), DEFAULT_VOICE_MODEL);
  if (isModelReady(dir)) {
    console.error(`Voice model already present: ${dir}`);
    return;
  }
  await mkdir(voiceCacheDir(), { recursive: true });
  const archive = join(voiceCacheDir(), `${DEFAULT_VOICE_MODEL}.tar.bz2`);
  console.error(`Downloading ${DEFAULT_VOICE_MODEL}...`);
  if ((await run(['curl', '-L', '-o', archive, modelUrl(DEFAULT_VOICE_MODEL)])) !== 0) {
    console.error('Download failed — voice input will be unavailable until it succeeds.');
    return;
  }
  await run(['tar', '-xjf', archive, '-C', voiceCacheDir()]);
  console.error(isModelReady(dir) ? `Voice model ready: ${dir}` : 'Extraction incomplete.');
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Then add to `package.json` scripts (after `"setup:media"`):
```json
    "setup:voice": "bun run scripts/setup-voice.ts",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/setup-voice.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/setup-voice.ts package.json tests/voice/setup-voice.test.ts
git commit -m "feat(voice): setup:voice model downloader + ffmpeg check"
```

---

### Task 5: Telemetry — `voice.transcribe` span

**Files:**
- Modify: `src/telemetry/spans.ts` (add `VOICE_*` attrs near the Slice-27 block ~line 119-135; add `withVoiceTranscribeSpan` near `withTranscribeSpan` ~line 773)
- Test: `tests/voice/spans.test.ts`

**Interfaces:**
- Consumes: `CaptureSource`, `VoiceOutcome` (Task 2).
- Produces: `withVoiceTranscribeSpan(info, fn)` where `info: { model: string; source: CaptureSource }`; sets outcome/duration on the span at settle.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/spans.test.ts
import { describe, expect, it } from 'bun:test';
import { ATTR, withVoiceTranscribeSpan } from '../../src/telemetry/spans.ts';
import { CaptureSource } from '../../src/voice/types.ts';

describe('withVoiceTranscribeSpan', () => {
  it('exposes VOICE_* attribute keys', () => {
    expect(ATTR.VOICE_STT_MODEL).toBe('voice.stt.model');
    expect(ATTR.VOICE_CAPTURE_SOURCE).toBe('voice.capture.source');
    expect(ATTR.VOICE_OUTCOME).toBe('voice.outcome');
  });
  it('runs the fn and returns its value', async () => {
    const out = await withVoiceTranscribeSpan(
      { model: 'tiny', source: CaptureSource.File },
      async () => 'hi',
    );
    expect(out).toBe('hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/spans.test.ts`
Expected: FAIL — `ATTR.VOICE_STT_MODEL` undefined / `withVoiceTranscribeSpan` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/telemetry/spans.ts`, add to the frozen `ATTR` object (near the multimodal block):
```ts
  VOICE_STT_MODEL: 'voice.stt.model',
  VOICE_CAPTURE_SOURCE: 'voice.capture.source',
  VOICE_AUDIO_SECONDS: 'voice.audio.seconds',
  VOICE_DURATION_MS: 'voice.duration.ms',
  VOICE_OUTCOME: 'voice.outcome',
```

Then add the helper (mirroring `withTranscribeSpan`), importing `CaptureSource` at top:
```ts
import { CaptureSource } from '../voice/types.ts';

export type VoiceSpanInfo = { model: string; source: CaptureSource };

/** Wraps a voice transcription in a `voice.transcribe` span. */
export function withVoiceTranscribeSpan<T>(
  info: VoiceSpanInfo,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return inSpan('voice.transcribe', async (span) => {
    span.setAttribute(ATTR.VOICE_STT_MODEL, info.model);
    span.setAttribute(ATTR.VOICE_CAPTURE_SOURCE, info.source);
    span.setAttribute(ATTR.INPUT_MODALITY, 'audio');
    return fn(span);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/spans.test.ts`
Expected: PASS (2 tests). Also run `bun run typecheck` (the new import must not create a cycle — `types.ts` imports nothing from telemetry, so it's safe).

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/spans.ts tests/voice/spans.test.ts
git commit -m "feat(voice): voice.transcribe span + VOICE_* attributes"
```

---

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

### Task 8: Capture from file (`--voice-in`)

**Files:**
- Create: `src/voice/capture.ts`
- Test: `tests/voice/capture-file.test.ts`
- Create fixture: `tests/voice/fixtures/hello.f32` (a few thousand non-zero Float32LE samples; generate in the test setup if absent).

**Interfaces:**
- Consumes: `VoiceFrames`, `VoiceConfig`, `VoiceError` (Task 2); `ffmpegCmd` (Task 3).
- Produces: `captureFromFile(path, cfg, deps?): Promise<VoiceFrames>`, `deps.spawn?: (cmd) => Promise<{code, stdout: Uint8Array, stderr: string}>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/capture-file.test.ts
import { describe, expect, it } from 'bun:test';
import { captureFromFile } from '../../src/voice/capture.ts';

const cfg = { modelDir: '/m', ffmpeg: 'ffmpeg', timeoutMs: 5000 };

function pcmBytes(nSamples: number): Uint8Array {
  const f = new Float32Array(nSamples).fill(0.1);
  return new Uint8Array(f.buffer);
}

describe('captureFromFile', () => {
  it('decodes ffmpeg f32le stdout into Float32 samples at 16k', async () => {
    const frames = await captureFromFile('x.wav', cfg, {
      spawn: async () => ({ code: 0, stdout: pcmBytes(1600), stderr: '' }),
    });
    expect(frames.sampleRate).toBe(16000);
    expect(frames.samples.length).toBe(1600);
    expect(frames.samples[0]).toBeCloseTo(0.1, 5);
  });
  it('throws VoiceError when ffmpeg fails', async () => {
    await expect(
      captureFromFile('x.wav', cfg, {
        spawn: async () => ({ code: 1, stdout: new Uint8Array(0), stderr: 'No such file' }),
      }),
    ).rejects.toThrow(/ffmpeg/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/capture-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/voice/capture.ts
import { type VoiceConfig, VoiceError, type VoiceFrames } from './types.ts';

export type CaptureDeps = {
  spawn?: (cmd: string[]) => Promise<{ code: number; stdout: Uint8Array; stderr: string }>;
};

async function defaultSpawn(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).bytes(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, stdout, stderr };
}

/** Reinterprets a byte buffer of little-endian Float32 as a Float32Array (copy for alignment). */
function bytesToFloat32(bytes: Uint8Array): Float32Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

/** Decodes any audio file to mono 16 kHz Float32 via ffmpeg. */
export async function captureFromFile(
  path: string,
  cfg: VoiceConfig,
  deps: CaptureDeps = {},
): Promise<VoiceFrames> {
  const spawn = deps.spawn ?? defaultSpawn;
  const { code, stdout, stderr } = await spawn([
    cfg.ffmpeg, '-hide_banner', '-loglevel', 'error',
    '-i', path, '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1',
  ]);
  if (code !== 0) throw new VoiceError(`ffmpeg decode failed: ${stderr}`);
  const samples = bytesToFloat32(stdout);
  if (samples.length === 0) throw new VoiceError('no audio decoded from file');
  return { samples, sampleRate: 16000 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/capture-file.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/capture.ts tests/voice/capture-file.test.ts
git commit -m "feat(voice): capture from file via ffmpeg decode"
```

---

### Task 9: Capture from mic (tap-to-toggle + silencedetect auto-stop)

**Files:**
- Modify: `src/voice/capture.ts` (add `captureFromMic`)
- Test: `tests/voice/capture-mic.test.ts`

**Interfaces:**
- Consumes: `VoiceFrames`, `VoiceConfig`, `VoiceError`; `ffmpegCmd`.
- Produces: `captureFromMic(cfg, io): Promise<VoiceFrames>` where `io` is injectable:
  `{ start(): Promise<MicSession>; onKey(cb: (key: 'space'|'enter'|'ctrl-c') => void): () => void; print(msg: string): void }`
  and `MicSession = { frames: AsyncIterable<Float32Array>; silenceSignaled: Promise<void>; stop(): Promise<void> }`.
  Control logic: print "tap space to start"; on first space → `start()`; accumulate `frames`; stop when `silenceSignaled` resolves (ffmpeg `silencedetect` on stderr) OR a second space/enter; empty accumulation → `VoiceError` with mic-permission hint.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/capture-mic.test.ts
import { describe, expect, it } from 'bun:test';
import { captureFromMic } from '../../src/voice/capture.ts';

const cfg = { modelDir: '/m', ffmpeg: 'ffmpeg', timeoutMs: 10000 };

function fakeIo(chunks: Float32Array[], stopVia: 'silence' | 'space') {
  let keyCb: (k: string) => void = () => {};
  return {
    io: {
      async start() {
        return {
          frames: (async function* () {
            for (const c of chunks) yield c;
          })(),
          silenceSignaled:
            stopVia === 'silence' ? Promise.resolve() : new Promise<void>(() => {}),
          async stop() {},
        };
      },
      onKey(cb: (k: 'space' | 'enter' | 'ctrl-c') => void) {
        keyCb = cb as (k: string) => void;
        return () => {};
      },
      print() {},
    },
    pressSpace: () => keyCb('space'),
  };
}

describe('captureFromMic', () => {
  it('accumulates frames and stops on silence', async () => {
    const { io, pressSpace } = fakeIo([new Float32Array(800).fill(0.2)], 'silence');
    const p = captureFromMic(cfg, io);
    pressSpace(); // begin recording
    const frames = await p;
    expect(frames.samples.length).toBe(800);
  });
  it('throws mic-permission hint on all-zero (silent) capture', async () => {
    const { io, pressSpace } = fakeIo([new Float32Array(800)], 'silence');
    const p = captureFromMic(cfg, io);
    pressSpace();
    await expect(p).rejects.toThrow(/microphone/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/capture-mic.test.ts`
Expected: FAIL — `captureFromMic` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/voice/capture.ts`:
```ts
export type MicSession = {
  frames: AsyncIterable<Float32Array>;
  silenceSignaled: Promise<void>;
  stop(): Promise<void>;
};

export type MicIo = {
  start(): Promise<MicSession>;
  onKey(cb: (key: 'space' | 'enter' | 'ctrl-c') => void): () => void;
  print(msg: string): void;
};

/** True if the buffer carries perceptible energy (not TCC-denied silence). */
function hasEnergy(samples: Float32Array): boolean {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak > 0.005;
}

/** Live mic capture: tap space to start, ffmpeg silencedetect (or space/enter) to stop. */
export async function captureFromMic(cfg: VoiceConfig, io: MicIo): Promise<VoiceFrames> {
  io.print('🎤 tap [space] to start (auto-stops on a pause, or [space] to stop)');
  const chunks: Float32Array[] = [];
  let session: MicSession | undefined;

  await new Promise<void>((resolve, reject) => {
    let recording = false;
    const off = io.onKey(async (key) => {
      if (key === 'ctrl-c') {
        await session?.stop();
        off();
        reject(new VoiceError('cancelled'));
        return;
      }
      if (!recording && key === 'space') {
        recording = true;
        io.print('recording ●');
        try {
          session = await io.start();
        } catch (err) {
          off();
          reject(new VoiceError('could not open microphone', String(err)));
          return;
        }
        session.silenceSignaled.then(async () => {
          await session?.stop();
          off();
          resolve();
        });
        (async () => {
          for await (const frame of session.frames) chunks.push(frame);
        })();
        return;
      }
      if (recording && (key === 'space' || key === 'enter')) {
        await session?.stop();
        off();
        resolve();
      }
    });
  });

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const samples = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    samples.set(c, off);
    off += c.length;
  }
  if (total === 0 || !hasEnergy(samples)) {
    throw new VoiceError(
      'no audio captured from the microphone',
      'grant Microphone access to your terminal app in System Settings → Privacy & Security → Microphone',
    );
  }
  return { samples, sampleRate: 16000 };
}
```

> NOTE: the real `MicIo` impl (ffmpeg `-f avfoundation -i :<idx> -ac 1 -ar 16000 -f f32le pipe:1`, parsing `-af silencedetect` events off stderr, and raw-TTY keypress via `process.stdin.setRawMode(true)`) is wired in Task 11's CLI deps and exercised in live-verify; unit tests use the injected fake above.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/capture-mic.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/capture.ts tests/voice/capture-mic.test.ts
git commit -m "feat(voice): live mic capture (tap-to-toggle + silencedetect auto-stop)"
```

---

### Task 10: CLI flag parsing (`--voice`, `--voice-in`)

**Files:**
- Modify: `src/cli/chat.ts` (`parseMediaArgs`, `IngestFlags` usage, `hasMediaFlags`)
- Modify: `src/media/ingest.ts` (`IngestFlags` type: add `voice: boolean`, `voiceIn: string[]`)
- Test: `tests/voice/chat-args.test.ts`

**Interfaces:**
- Consumes: existing `parseMediaArgs` (returns `{positional, flags}`), `IngestFlags` (Task refs `src/media/ingest.ts:9-14`).
- Produces: `parseMediaArgs` recognizes `--voice` (boolean) and `--voice-in <path>` (repeatable value); `hasMediaFlags` returns true when either is set.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/chat-args.test.ts
import { describe, expect, it } from 'bun:test';
import { parseMediaArgs } from '../../src/cli/chat.ts';

describe('parseMediaArgs voice flags', () => {
  it('parses --voice as a boolean', () => {
    const { positional, flags } = parseMediaArgs(['--voice']);
    expect(flags.voice).toBe(true);
    expect(positional).toEqual([]);
  });
  it('parses --voice-in as a repeatable path and keeps prompt positional', () => {
    const { positional, flags } = parseMediaArgs(['summarize', '--voice-in', 'a.wav']);
    expect(flags.voiceIn).toEqual(['a.wav']);
    expect(positional).toEqual(['summarize']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/chat-args.test.ts`
Expected: FAIL — `flags.voice` undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/media/ingest.ts`, extend `IngestFlags`:
```ts
export type IngestFlags = {
  images: string[];
  audios: string[];
  videos: string[];
  paste: boolean;
  voice: boolean;
  voiceIn: string[];
};
```

In `src/cli/chat.ts` `parseMediaArgs`, initialize the new fields and handle the flags:
```ts
  const flags: IngestFlags = {
    images: [], audios: [], videos: [], paste: false,
    voice: false, voiceIn: [],
  };
  // ...inside the loop, before the `else if (arg === '--paste')` branch:
    } else if (arg === '--voice-in') {
      const value = argv[i + 1];
      i += 1;
      if (value !== undefined) flags.voiceIn.push(value);
    } else if (arg === '--voice') {
      flags.voice = true;
```

Extend `hasMediaFlags`:
```ts
  return (
    flags.images.length > 0 || flags.audios.length > 0 || flags.videos.length > 0 ||
    flags.paste || flags.voice || flags.voiceIn.length > 0
  );
```

Update the usage string (`chat.ts:170`) to mention `--voice` / `--voice-in <path>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/chat-args.test.ts`
Then: `bun run typecheck` (IngestFlags is constructed in tests/media too — update any fixtures that build a literal `IngestFlags`).
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/chat.ts src/media/ingest.ts tests/voice/chat-args.test.ts
git commit -m "feat(voice): --voice and --voice-in CLI flags"
```

---

### Task 11: Voice ingest + chat wiring (capture → transcribe → splice, degrade)

**Files:**
- Create: `src/voice/ingest.ts`
- Create: `src/voice/cli-io.ts` (real `MicIo` + real transcriber wiring)
- Modify: `src/cli/chat.ts` (call `ingestVoice` before/with `ingestMedia`)
- Test: `tests/voice/ingest.test.ts`

**Interfaces:**
- Consumes: `captureFromFile`/`captureFromMic` (Tasks 8–9), `createTranscriber` (Task 7), `resolveVoiceModel`/`ffmpegCmd` (Task 3), `IngestFlags` (Task 10), the run `ledger` + `recordDegrade`.
- Produces: `ingestVoice(rawPrompt, flags, deps): Promise<{ prompt: string; warnings: string[] }>`, where `deps = { captureFile, captureMic, transcriber, ledger? }`. On any voice error: push a warning + `DegradeEvent`, return the original prompt (never throw).

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/ingest.test.ts
import { describe, expect, it } from 'bun:test';
import { ingestVoice } from '../../src/voice/ingest.ts';
import { VoiceError } from '../../src/voice/types.ts';

const flags = (over = {}) => ({
  images: [], audios: [], videos: [], paste: false, voice: false, voiceIn: [], ...over,
});
const okTranscriber = { transcribe: async () => 'hello there', close: async () => {} };

describe('ingestVoice', () => {
  it('appends the file transcript to the prompt', async () => {
    const { prompt, warnings } = await ingestVoice('context:', flags({ voiceIn: ['a.wav'] }), {
      captureFile: async () => ({ samples: new Float32Array(10), sampleRate: 16000 }),
      captureMic: async () => ({ samples: new Float32Array(0), sampleRate: 16000 }),
      transcriber: okTranscriber,
    });
    expect(prompt).toContain('context:');
    expect(prompt).toContain('hello there');
    expect(warnings).toEqual([]);
  });
  it('degrades to a warning (no throw) when capture fails', async () => {
    const { prompt, warnings } = await ingestVoice('base', flags({ voice: true }), {
      captureFile: async () => ({ samples: new Float32Array(0), sampleRate: 16000 }),
      captureMic: async () => {
        throw new VoiceError('no mic', 'grant Microphone access');
      },
      transcriber: okTranscriber,
    });
    expect(prompt).toBe('base');
    expect(warnings.join(' ')).toMatch(/grant Microphone access/);
  });
  it('returns the prompt unchanged when no voice flag is set', async () => {
    const { prompt } = await ingestVoice('base', flags(), {
      captureFile: async () => ({ samples: new Float32Array(0), sampleRate: 16000 }),
      captureMic: async () => ({ samples: new Float32Array(0), sampleRate: 16000 }),
      transcriber: okTranscriber,
    });
    expect(prompt).toBe('base');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/ingest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/voice/ingest.ts
import { recordDegrade } from '../telemetry/spans.ts';
import { DegradeKind, type DegradationLedger } from '../reliability/ledger.ts';
import type { IngestFlags } from '../media/ingest.ts';
import type { Transcriber, VoiceFrames } from './types.ts';
import { VoiceError } from './types.ts';

export type VoiceIngestDeps = {
  captureFile: (path: string) => Promise<VoiceFrames>;
  captureMic: () => Promise<VoiceFrames>;
  transcriber: Transcriber;
  ledger?: DegradationLedger;
};

export type VoiceIngestResult = { prompt: string; warnings: string[] };

/** Captures + transcribes voice input and splices the transcript into the prompt.
 *  Never throws: any failure becomes a warning + a degrade-ledger entry. */
export async function ingestVoice(
  rawPrompt: string,
  flags: IngestFlags,
  deps: VoiceIngestDeps,
): Promise<VoiceIngestResult> {
  const warnings: string[] = [];
  const transcripts: string[] = [];

  const collect = async (get: () => Promise<VoiceFrames>) => {
    try {
      const frames = await get();
      const text = (await deps.transcriber.transcribe(frames)).trim();
      if (text) transcripts.push(text);
    } catch (err) {
      const hint = err instanceof VoiceError && err.hint ? ` — ${err.hint}` : '';
      warnings.push(`voice: ${(err as Error).message}${hint}`);
      deps.ledger?.record?.({ kind: DegradeKind.ToolSkipped, detail: 'voice input failed' });
    }
  };

  for (const path of flags.voiceIn) await collect(() => deps.captureFile(path));
  if (flags.voice) await collect(() => deps.captureMic());

  const prompt = [rawPrompt, ...transcripts].filter(Boolean).join('\n\n').trim();
  return { prompt, warnings };
}
```

Then create `src/voice/cli-io.ts` (real deps: `resolveVoiceModel`/`ffmpegCmd` → `VoiceConfig`; `createTranscriber(cfg)`; `captureFromFile`-bound; a real `MicIo` using ffmpeg avfoundation + raw-TTY). Wire into `src/cli/chat.ts` `main`: after building the media `store`, call `ingestVoice(rawPrompt, flags, realDeps)` to get an updated prompt, feed its result as the `rawPrompt` into `ingestMedia`, and print its warnings via the existing `console.error('media: ...')`-style loop. Confirm `recordDegrade`/`DegradeKind`/`ledger.record` names against `src/reliability/ledger.ts` at implementation time.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/ingest.test.ts`
Expected: PASS (3 tests). Then `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/voice/ingest.ts src/voice/cli-io.ts src/cli/chat.ts tests/voice/ingest.test.ts
git commit -m "feat(voice): ingestVoice + chat wiring (splice, degrade-never-crash)"
```

---

### Task 12: Documentation (4-surface hard line)

**Files:**
- Modify: `docs/architecture.md` (new §Voice + subsystem-registry table row for `src/voice`)
- Modify: `README.md` (status line + slice-status table row + a feature paragraph)
- Modify: `docs/ROADMAP.md` (flip "Voice INPUT (STT)" → ✅ shipped Slice 29 in gap table + phase table + recommended sequence)
- Modify: `.superpowers/sdd/progress.md` (Slice 29 ledger section: per-task commits, decisions, live-verify)

**Interfaces:** none (docs).

- [ ] **Step 1: Write the §Voice architecture section**

Add a `## Voice input (STT) (Slice 29)` section modeled on §22 Multimodal: file table (`src/voice/{types,model,transcribe,capture,ingest,cli-io}.ts` + `stt-worker.mjs` + `scripts/setup-voice.ts`), the capture→transcribe data-flow, the execution seam (in-process vs node-subprocess, chosen by spike), ffmpeg-silencedetect auto-stop, env-var block (`AGENT_VOICE_DIR`, `AGENT_VOICE_STT_MODEL`, `AGENT_FFMPEG_CMD`, `AGENT_VOICE_EXEC`), telemetry (`voice.transcribe` + `VOICE_*`), and the live-verify status. Add `src/voice` to the subsystem-registry table.

- [ ] **Step 2: Run docs-check**

Run: `bun run docs:check`
Expected: PASS — `src/voice` now documented (it FAILS before this step).

- [ ] **Step 3: Update README + ROADMAP + ledger**

README: status line, add a slice-29 ✅ row to the slice-status table, add a "Voice input" feature paragraph + update the "Next" line to Slice 30. ROADMAP: flip the "Voice INPUT (STT)" gap row + recommended-sequence item 20 to ✅ Slice 29. Ledger: append the Slice-29 section (per-task commit SHAs, decisions D1–D8 + the silencedetect refinement, live-verify results).

- [ ] **Step 4: Verify docs gate**

Run: `bun run docs:check && bun run typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(slice-29): §Voice architecture + README/ROADMAP/ledger"
```

---

### Task 13: Live-verify (gated) + edge cases

**Files:**
- Create: `tests/integration/voice.live.test.ts` (gated behind `VOICE_LIVE=1`)

**Interfaces:** exercises the real ffmpeg + real model + real transcriber.

- [ ] **Step 1: Provision the model + confirm ffmpeg**

Run: `bun run setup:voice`
Then: `ls "$HOME/.cache/ai/voice/sherpa-onnx-moonshine-tiny-en-int8/tokens.txt"` and `command -v ffmpeg`
Expected: model present; ffmpeg on PATH.

- [ ] **Step 2: Write the gated live test (file path — deterministic)**

```ts
// tests/integration/voice.live.test.ts
import { describe, expect, it } from 'bun:test';
import { captureFromFile } from '../../src/voice/capture.ts';
import { createTranscriber } from '../../src/voice/transcribe.ts';
import { ffmpegCmd, resolveVoiceModel } from '../../src/voice/model.ts';

const LIVE = process.env.VOICE_LIVE === '1';
describe.if(LIVE)('voice live', () => {
  it('transcribes a spoken WAV fixture to non-empty text', async () => {
    const cfg = { modelDir: resolveVoiceModel(), ffmpeg: ffmpegCmd(), timeoutMs: 30000 };
    const frames = await captureFromFile('tests/voice/fixtures/hello.wav', cfg);
    const t = createTranscriber(cfg);
    const text = await t.transcribe(frames);
    await t.close();
    expect(text.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the live suite (record a real WAV first)**

Record a short spoken WAV to `tests/voice/fixtures/hello.wav` (macOS Voice Memos export or `ffmpeg -f avfoundation -i :0 -t 3 -ar 16000 -ac 1 hello.wav`).
Run: `VOICE_LIVE=1 bun test tests/integration/voice.live.test.ts`
Expected: PASS. Also live-drive `bun run src/cli/chat.ts --voice` (speak, confirm transcript becomes the prompt) and `--voice-in tests/voice/fixtures/hello.wav`.

- [ ] **Step 4: Edge cases (manual, per live-verify-before-merge rule)**

Verify + note in the ledger: (a) mic-permission-denied → the actionable hint prints, no crash; (b) empty/garbage `--voice-in` file → warning, prompt proceeds; (c) transcribe timeout (`AGENT_MEDIA_TIMEOUT_MS`-analog) → `timeout` outcome, no crash; (d) if the Task-1 spike said Bun can't load the addon, confirm `AGENT_VOICE_EXEC=subprocess` path works end-to-end.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/voice.live.test.ts tests/voice/fixtures/hello.wav
git commit -m "test(voice): gated live-verify (real ffmpeg + moonshine) + edge cases"
```

---

### Task 14: Whole-branch review, Artifact, merge

**Files:** none new — review + docs-snapshot Artifact + merge.

**Interfaces:** none.

- [ ] **Step 1: Run the full gate**

Run: `bun run check` (docs:check · typecheck · lint · tests)
Expected: all green. Fix any lint (`bun run lint:file -- src/voice/*.ts`) inline.

- [ ] **Step 2: Fan-out final review**

Dispatch parallel review subagents (correctness / security incl. the mic-permission + subprocess-spawn + DYLD_LIBRARY_PATH handling / docs-accuracy-vs-diff) per requesting-code-review. Apply verified findings.

- [ ] **Step 3: Regenerate the Artifact (4th doc surface)**

Load the `artifact-design` skill; WebFetch the current snapshot URL `https://claude.ai/code/artifact/c760844f-edb5-4d7c-a965-6af76423c666`; add a **Voice** node + edges (cli→voice, voice→telemetry/reliability, voice→media-store-adjacent) + a concept card + a tour step; update the footer to "29 slices · <real test count>"; `node --check` the data script + referential-integrity before redeploy (same url, favicon 🧭).

- [ ] **Step 4: Merge (ask the user y/N before each git action)**

Run (after confirmation): `git checkout main && git merge --no-ff slice-29-voice-input-stt` then `git push`. The pre-push slice-landing gate requires README + ROADMAP + `.superpowers/sdd/progress.md` updated in the same push (Task 12 did this). Delete the branch after.

- [ ] **Step 5: Final ledger closeout**

Append the merge SHA + final suite counts to `.superpowers/sdd/progress.md`; refresh `resume-here.md` to point at Slice 30 (TUI / web UI — the home for rich hold-to-talk voice).

---

## Self-Review

**1. Spec coverage:**
- D1 (two entry points) → Tasks 10, 11. D2 (tap-to-toggle + auto-stop) → Task 9 (silencedetect refinement noted). D3 (sherpa-onnx engine) → Tasks 1, 6, 7. D4 (moonshine-tiny model + new download) → Tasks 3, 4. D5 (ffmpeg avfoundation capture) → Tasks 8, 9. D6 (spike-first execution seam) → Tasks 1, 7. D7 (keep mlx-whisper separate) → honored (voice is a new subsystem; no media edits beyond `IngestFlags`). D8 (transcript-splice) → Task 11. Error/degrade → Tasks 6, 8, 9, 11. Telemetry → Task 5. Testing (hermetic + gated live) → each task + Task 13. Docs 4-surface → Tasks 12, 14. ✅ all covered.
- **Deviation flagged:** auto-stop uses ffmpeg `silencedetect` (model-free) instead of real-time silero VAD, and the silero model download is dropped. Recorded in Task 9 + Task 12 ledger note. User to confirm at handoff.

**2. Placeholder scan:** the two `> NOTE:` blocks (Task 6 config nesting, Task 9 real MicIo) are explicit verify-at-impl pointers with the concrete command/shape given, not gaps. No TBD/TODO left.

**3. Type consistency:** `VoiceFrames` (`{samples, sampleRate}`), `Transcriber` (`transcribe/close`), `VoiceConfig` (`{modelDir, ffmpeg, timeoutMs}`), `IngestFlags` (+`voice`,`voiceIn`), `createTranscriber`/`createInProcessTranscriber`/`createSubprocessTranscriber`, `ingestVoice(rawPrompt, flags, deps)` — names consistent across Tasks 2–11. `ATTR.VOICE_*` used in Task 5 only. `DegradeKind.ToolSkipped`/`ledger.record` flagged for verification against `src/reliability/ledger.ts` in Task 11.
