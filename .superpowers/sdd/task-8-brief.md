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

