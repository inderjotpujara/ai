### Task 6: `createAudioCapture` (getUserMedia + AudioWorklet wiring) + `downsample-worklet.ts` + `setup.ts` stubs

The worklet processor itself (`downsample-worklet.ts`) runs inside the browser's real-time audio-rendering thread — it cannot execute under happy-dom/Vitest. This task tests `createAudioCapture`'s **lifecycle** (getUserMedia call shape, start/stop, chunk/level fan-out, track teardown) against fixture Web Audio globals added to the shared test setup; the worklet file's actual resample behavior is already fully covered by Task 5's direct `createDownsampler` tests (it is a thin wrapper with no logic of its own beyond calling `process()`/`flush()`).

**Files:**
- Modify: `web/src/features/voice/audio-capture.ts` (append `createAudioCapture` below `createDownsampler`)
- Create: `web/src/features/voice/downsample-worklet.ts`
- Modify: `web/src/test/setup.ts` (append Web Audio / getUserMedia fixtures)
- Modify: `web/src/features/voice/audio-capture.test.ts` (append `describe('createAudioCapture', ...)`)

**Interfaces:**
- Consumes: `createDownsampler` (Task 5, same file, used only inside `downsample-worklet.ts`).
- Produces: `export type AudioCapture = { start(): Promise<void>; stop(): Promise<void>; onChunk(cb): () => void; onLevel(cb): () => void; readonly active: boolean };` and `export function createAudioCapture(): AudioCapture;`. Consumed by `use-voice-input.ts` (Part B, Task 10+). Also exports `FakeMediaStream`/`FakeAudioContext`/`FakeAudioWorkletNode`/`getLastAudioWorkletNode` fixtures from `web/src/test/setup.ts`, reused by any future voice test needing to simulate a worklet message.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/test/setup.ts`:

```ts
// --- Web Audio / getUserMedia fixtures (Slice 30b Phase 7 voice input) ---
// happy-dom implements neither `navigator.mediaDevices` nor any Web Audio
// API (no AudioContext/AudioWorkletNode). These are deliberately minimal,
// REAL (not `vi.fn()` no-ops) fakes: a track whose `.stop()` flips
// `readyState` to 'ended' so lifecycle tests can assert genuine teardown
// (spec §7.2(c)), and an AudioContext/AudioWorkletNode pair whose methods
// are spies. `audio-capture.test.ts` grabs the constructed node via
// `getLastAudioWorkletNode()` to simulate a worklet `port.onmessage` chunk —
// the ONLY way to drive `createAudioCapture`'s chunk/level fan-out under
// happy-dom, since the real worklet can't run here (Task 5/6 split: the
// resample math is tested directly against `createDownsampler`, never
// through this fake).
export class FakeMediaStreamTrack {
  readyState: 'live' | 'ended' = 'live';
  stop() {
    this.readyState = 'ended';
  }
}

export class FakeMediaStream {
  private tracks = [new FakeMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeAudioWorklet {
  addModule = vi.fn().mockResolvedValue(undefined);
}

export class FakeAudioWorkletNode {
  port: {
    onmessage: ((event: MessageEvent) => void) | null;
    close: () => void;
  } = { onmessage: null, close: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(
    public context: unknown,
    public name: string,
    public options?: unknown,
  ) {
    lastAudioWorkletNode = this;
  }
}

export class FakeAudioContext {
  sampleRate = 48000;
  audioWorklet = new FakeAudioWorklet();
  close = vi.fn().mockResolvedValue(undefined);
  createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  constructor() {
    lastAudioContext = this;
  }
}

let lastAudioWorkletNode: FakeAudioWorkletNode | undefined;
export function getLastAudioWorkletNode(): FakeAudioWorkletNode | undefined {
  return lastAudioWorkletNode;
}

let lastAudioContext: FakeAudioContext | undefined;
export function getLastAudioContext(): FakeAudioContext | undefined {
  return lastAudioContext;
}

let lastGetUserMediaConstraints: unknown;
export function getLastGetUserMediaConstraints(): unknown {
  return lastGetUserMediaConstraints;
}

let lastMediaStream: FakeMediaStream | undefined;
export function getLastMediaStream(): FakeMediaStream | undefined {
  return lastMediaStream;
}

beforeEach(() => {
  lastAudioWorkletNode = undefined;
  lastAudioContext = undefined;
  lastGetUserMediaConstraints = undefined;
  lastMediaStream = undefined;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn((constraints: unknown) => {
        lastGetUserMediaConstraints = constraints;
        lastMediaStream = new FakeMediaStream();
        return Promise.resolve(lastMediaStream);
      }),
    },
  });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
});
```

Modify the top of `web/src/features/voice/audio-capture.test.ts` — add a new import line for the `setup.ts` fixtures, and merge `createAudioCapture` into the existing `./audio-capture.ts` import from Task 5 (so there is one import statement per module, not two):

```ts
import { describe, expect, it } from 'vitest';
import {
  getLastAudioContext,
  getLastAudioWorkletNode,
  getLastGetUserMediaConstraints,
  getLastMediaStream,
} from '../../test/setup.ts';
import { createAudioCapture, createDownsampler } from './audio-capture.ts';
```

Then append the new `describe` block at the bottom of the same file:

```ts
describe('createAudioCapture', () => {
  it('start() requests AEC/noise-suppression/AGC getUserMedia, opens an AudioContext + worklet, and flips active', async () => {
    const capture = createAudioCapture();
    expect(capture.active).toBe(false);
    await capture.start();
    expect(capture.active).toBe(true);
    expect(getLastGetUserMediaConstraints()).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(getLastAudioWorkletNode()).toBeDefined();
  });

  it('forwards worklet chunks to onChunk subscribers and a computed RMS level to onLevel subscribers', async () => {
    const capture = createAudioCapture();
    await capture.start();
    const chunks: Float32Array[] = [];
    const levels: number[] = [];
    capture.onChunk((c) => chunks.push(c));
    capture.onLevel((l) => levels.push(l));

    const node = getLastAudioWorkletNode();
    const chunk = new Float32Array([1, -1, 1, -1]); // RMS = 1
    node?.port.onmessage?.({ data: chunk } as MessageEvent);

    expect(chunks).toEqual([chunk]);
    expect(levels).toEqual([1]);
  });

  it('onChunk/onLevel unsubscribe stops further callbacks', async () => {
    const capture = createAudioCapture();
    await capture.start();
    const chunks: Float32Array[] = [];
    const unsubscribe = capture.onChunk((c) => chunks.push(c));
    unsubscribe();

    const node = getLastAudioWorkletNode();
    node?.port.onmessage?.({ data: new Float32Array([0.5]) } as MessageEvent);

    expect(chunks).toEqual([]);
  });

  it('stop() stops every MediaStream track, closes the AudioContext, and flips active off', async () => {
    const capture = createAudioCapture();
    await capture.start();
    const stream = getLastMediaStream();
    const ctx = getLastAudioContext();
    await capture.stop();
    expect(capture.active).toBe(false);
    for (const track of stream?.getTracks() ?? []) {
      expect(track.readyState).toBe('ended');
    }
    expect(ctx?.close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: FAIL — `createAudioCapture` is not exported from `./audio-capture.ts`; `getLastAudioWorkletNode`/`getLastGetUserMediaConstraints` are not exported from `../../test/setup.ts`.

- [ ] **Step 3: Write minimal implementation**

Append to `web/src/features/voice/audio-capture.ts` (below `createDownsampler`):

```ts
const WORKLET_MODULE_URL = new URL('./downsample-worklet.ts', import.meta.url);
const WORKLET_PROCESSOR_NAME = 'downsample-processor';

export type AudioCapture = {
  start(): Promise<void>;
  stop(): Promise<void>;
  onChunk(cb: (chunk16k: Float32Array) => void): () => void;
  onLevel(cb: (rms: number) => void): () => void;
  readonly active: boolean;
};

function rms(chunk: Float32Array): number {
  if (chunk.length === 0) return 0;
  let sumSquares = 0;
  for (const v of chunk) sumSquares += v * v;
  return Math.sqrt(sumSquares / chunk.length);
}

/**
 * Wraps `getUserMedia` (with AEC/noise-suppression/AGC — the real acoustic
 * echo cancellation Slice 29's CLI never had, D3) and an `AudioWorkletNode`
 * running `downsample-worklet.ts`. 16 kHz mono chunks arrive via
 * `node.port.onmessage` and fan out to `onChunk` subscribers; an RMS level
 * (0..1-ish for a normalized signal) fans out to `onLevel` subscribers for
 * `waveform.tsx` (Part B).
 */
export function createAudioCapture(): AudioCapture {
  let stream: MediaStream | undefined;
  let ctx: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let active = false;
  const chunkListeners = new Set<(chunk16k: Float32Array) => void>();
  const levelListeners = new Set<(rms: number) => void>();

  async function start(): Promise<void> {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule(WORKLET_MODULE_URL);
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, WORKLET_PROCESSOR_NAME, {
      processorOptions: { inputRate: ctx.sampleRate },
    });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const chunk = event.data;
      for (const cb of chunkListeners) cb(chunk);
      const level = rms(chunk);
      for (const cb of levelListeners) cb(level);
    };
    source.connect(node);
    active = true;
  }

  async function stop(): Promise<void> {
    for (const track of stream?.getTracks() ?? []) track.stop();
    source?.disconnect();
    node?.disconnect();
    await ctx?.close();
    stream = undefined;
    ctx = undefined;
    source = undefined;
    node = undefined;
    active = false;
  }

  return {
    start,
    stop,
    onChunk(cb) {
      chunkListeners.add(cb);
      return () => chunkListeners.delete(cb);
    },
    onLevel(cb) {
      levelListeners.add(cb);
      return () => levelListeners.delete(cb);
    },
    get active() {
      return active;
    },
  };
}
```

Create `web/src/features/voice/downsample-worklet.ts`:

```ts
// Runs inside the browser's real-time AudioWorkletGlobalScope — NOT
// unit-testable under happy-dom/Vitest (no such runtime exists there). The
// only logic here is wiring `createDownsampler` (Task 5, fully unit-tested
// in isolation) to the Web Audio `process()` callback; verified for real in
// the Part B live-verify increment (Task 18).
//
// `AudioWorkletProcessor`/`registerProcessor` are not part of any standard
// TypeScript lib (`dom` does not include the worklet global scope) — these
// two ambient declarations stand in for the real browser globals so this
// file typechecks; they are never actually defined at compile time, only at
// runtime inside a real AudioWorkletGlobalScope.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

import { createDownsampler } from './audio-capture.ts';

class DownsampleProcessor extends AudioWorkletProcessor {
  private readonly downsampler: ReturnType<typeof createDownsampler>;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const inputRate =
      (options?.processorOptions as { inputRate: number } | undefined)
        ?.inputRate ?? 48000;
    this.downsampler = createDownsampler(inputRate);
  }

  override process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      const chunk16k = this.downsampler.process(channel);
      if (chunk16k.length > 0) {
        this.port.postMessage(chunk16k, [chunk16k.buffer]);
      }
    }
    return true; // keep the processor alive across renders
  }
}

registerProcessor('downsample-processor', DownsampleProcessor);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/audio-capture.test.ts`
Expected: PASS (11 tests total: 7 from Task 5 + 4 new `createAudioCapture` tests).

Run: `cd web && bun run typecheck`
Expected: PASS — confirms `downsample-worklet.ts`'s ambient `AudioWorkletProcessor`/`registerProcessor` declarations and the `override process()` compile cleanly, and that `createAudioCapture`'s `AudioContext`/`AudioWorkletNode`/`MediaStreamAudioSourceNode` usage matches the DOM lib types.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/audio-capture.ts web/src/features/voice/downsample-worklet.ts web/src/features/voice/audio-capture.test.ts web/src/test/setup.ts
git commit -m "feat(voice): createAudioCapture (getUserMedia+AudioWorklet) + downsample-worklet processor (D3/D4)"
```

---

## Increment 3: STT worker + lazy load (Tasks 7–9)

