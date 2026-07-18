import type { VoiceFrames } from '@contracts';
import { ModelTier } from './model-tier.ts';
import type { SttWorkerRequest, SttWorkerResponse } from './stt.worker.ts';

export { ModelTier };
export type LoadProgress = { loaded: number; total: number };

export type SttEngine = {
  ready(): Promise<void>;
  onProgress(cb: (p: LoadProgress) => void): () => void;
  detectSpeech(chunk16k: Float32Array): Promise<boolean>;
  transcribe(frames: VoiceFrames): Promise<string>;
  close(): void;
};

type Pending<T> = { resolve: (v: T) => void; reject: (err: Error) => void };

/**
 * Main-thread host for the STT Web Worker (D4): spawns `stt.worker.ts`,
 * posts a `load` request for the configured model tier immediately, and
 * exposes a request/response-matched (by numeric id) API over
 * `postMessage`. `ready()` resolves only once the worker's `ready` message
 * arrives — callers (`use-voice-input.ts`, Part B) gate capture start on
 * this, never on construction alone (spec §7.2). `detectSpeech`/`transcribe`
 * are NOT gated on readiness themselves — they post immediately and let the
 * worker's own protocol (result or `error`) resolve the matching promise,
 * so a call issued before `ready` is never silently lost, just answered
 * later (or rejected with the worker's "not loaded" error).
 */
export function createSttEngine(cfg: { model: ModelTier }): SttEngine {
  const worker = new Worker(new URL('./stt.worker.ts', import.meta.url), {
    type: 'module',
  });

  const progressListeners = new Set<(p: LoadProgress) => void>();
  let readyResolve!: () => void;
  let readyReject!: (err: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  let nextId = 1;
  const pendingDetect = new Map<number, Pending<boolean>>();
  const pendingTranscribe = new Map<number, Pending<string>>();

  worker.onmessage = (event: MessageEvent<SttWorkerResponse>) => {
    const msg = event.data;
    if (msg.kind === 'progress') {
      for (const cb of progressListeners)
        cb({ loaded: msg.loaded, total: msg.total });
      return;
    }
    if (msg.kind === 'ready') {
      readyResolve();
      return;
    }
    if (msg.kind === 'detectSpeechResult') {
      pendingDetect.get(msg.id)?.resolve(msg.isSpeech);
      pendingDetect.delete(msg.id);
      return;
    }
    if (msg.kind === 'transcribeResult') {
      pendingTranscribe.get(msg.id)?.resolve(msg.text);
      pendingTranscribe.delete(msg.id);
      return;
    }
    if (msg.kind === 'error') {
      if (msg.id !== undefined) {
        pendingDetect.get(msg.id)?.reject(new Error(msg.message));
        pendingDetect.delete(msg.id);
        pendingTranscribe.get(msg.id)?.reject(new Error(msg.message));
        pendingTranscribe.delete(msg.id);
      } else {
        readyReject(new Error(msg.message));
      }
    }
  };

  worker.postMessage({
    kind: 'load',
    model: cfg.model,
  } satisfies SttWorkerRequest);

  function ready(): Promise<void> {
    return readyPromise;
  }

  function onProgress(cb: (p: LoadProgress) => void): () => void {
    progressListeners.add(cb);
    return () => progressListeners.delete(cb);
  }

  function detectSpeech(chunk16k: Float32Array): Promise<boolean> {
    const id = nextId++;
    return new Promise<boolean>((resolve, reject) => {
      pendingDetect.set(id, { resolve, reject });
      worker.postMessage(
        {
          kind: 'detectSpeech',
          id,
          chunk: chunk16k,
        } satisfies SttWorkerRequest,
        [chunk16k.buffer],
      );
    });
  }

  function transcribe(frames: VoiceFrames): Promise<string> {
    const id = nextId++;
    return new Promise<string>((resolve, reject) => {
      pendingTranscribe.set(id, { resolve, reject });
      worker.postMessage(
        {
          kind: 'transcribe',
          id,
          samples: frames.samples,
        } satisfies SttWorkerRequest,
        [frames.samples.buffer],
      );
    });
  }

  function close(): void {
    worker.terminate();
    pendingDetect.clear();
    pendingTranscribe.clear();
    progressListeners.clear();
  }

  return { ready, onProgress, detectSpeech, transcribe, close };
}
