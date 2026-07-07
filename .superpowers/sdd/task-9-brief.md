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

