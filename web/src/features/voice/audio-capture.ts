// Re-exported so `createDownsampler` stays importable from this module (its
// original home) for existing consumers and `audio-capture.test.ts`, while
// the actual math lives in a zero-dependency module that BOTH this file and
// the AudioWorklet chunk can bundle cleanly — see `downsampler.ts`.
export { createDownsampler } from './downsampler.ts';

// The AudioWorklet module is loaded via Vite's `?worker&url` import (NOT the
// `new URL('./x.ts', import.meta.url)` asset pattern, which Rolldown does
// NOT transpile/emit for a worklet — that shipped a raw, unservable `.ts`
// URL to `addModule` and was the "Unable to load a worklet's module"
// live-verify defect). `?worker&url` makes Vite compile `downsample-worklet.ts`
// and its `createDownsampler` dependency into a single self-contained JS
// chunk (respecting this project's `worker.format: 'es'`) and hands back the
// served URL — exactly what `audioWorklet.addModule` needs, since a worklet
// global scope cannot resolve runtime `import`s.
import WORKLET_MODULE_URL from './downsample-worklet.ts?worker&url';

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
