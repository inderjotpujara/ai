const OUTPUT_RATE = 16000;

/**
 * Streaming linear-interpolation resampler from `inputRate` down to the
 * fixed 16 kHz `VoiceFrames` rate. Carries continuous state across
 * `process()` calls so an AudioWorklet render-quantum boundary (128 frames,
 * arbitrary with respect to the resample ratio — Web Audio spec) never
 * drops or duplicates a sample (spec §7.1). Mirrors `src/voice/capture.ts`'s
 * `carryPcmChunk` leftover-byte-carry pattern, adapted from byte-alignment
 * to continuous-time resampling.
 *
 * Output samples sit on the continuous grid `p_k = k * ratio` (in GLOBAL
 * input-sample-index units, k = 0, 1, 2, ...). `nextP` is the next `p_k` to
 * compute; `globalOffsetSoFar` is the global index of the first sample in
 * the quantum about to be processed; `prevLast` is the previous quantum's
 * final sample, needed only when an output position's lower interpolation
 * index falls exactly on that boundary sample (`idxLow === -1`). This makes
 * the function's output PROVABLY invariant to how the same total input is
 * chunked: re-chunking only changes which call computes which output
 * sample, never the sequence of floating-point operations performed.
 */
export function createDownsampler(inputRate: number): {
  process(quantum: Float32Array): Float32Array;
  flush(): Float32Array;
} {
  const ratio = inputRate / OUTPUT_RATE;
  let nextP = 0;
  let globalOffsetSoFar = 0;
  let prevLast: number | undefined;

  function process(quantum: Float32Array): Float32Array {
    const n = quantum.length;
    if (n === 0) return new Float32Array(0);
    const out: number[] = [];
    const upperBound = globalOffsetSoFar + n - 1;
    while (nextP < upperBound) {
      const floorP = Math.floor(nextP);
      const frac = nextP - floorP;
      const idxLow = floorP - globalOffsetSoFar;
      // Invariant (proven in the doc comment above): idxLow is always >= -1
      // here, and idxLow+1 is always a valid index into `quantum` — so
      // these reads are safe despite `noUncheckedIndexedAccess`.
      const s0 =
        idxLow === -1 ? (prevLast as number) : (quantum[idxLow] as number);
      const s1 =
        idxLow === -1
          ? (quantum[0] as number)
          : (quantum[idxLow + 1] as number);
      out.push(s0 + (s1 - s0) * frac);
      nextP += ratio;
    }
    globalOffsetSoFar += n;
    prevLast = quantum[n - 1];
    return new Float32Array(out);
  }

  function flush(): Float32Array {
    // No output sample is ever withheld beyond what `process()` already
    // emitted: a point is only produced once BOTH its bracketing input
    // samples are known, so there is nothing left to synthesize at stop
    // without extrapolating audio that was never captured. Reset state so
    // the instance is safe to reuse for a fresh capture session.
    nextP = 0;
    globalOffsetSoFar = 0;
    prevLast = undefined;
    return new Float32Array(0);
  }

  return { process, flush };
}

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
