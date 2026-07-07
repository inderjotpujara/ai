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

