import type { VoiceFrames } from '@contracts';
import { ModelTier } from './model-tier.ts';
import type { SttWorkerRequest, SttWorkerResponse } from './stt.worker.ts';

export { ModelTier };
export type LoadProgress = { loaded: number; total: number };

export type SttEngine = {
  ready(): Promise<void>;
  onProgress(cb: (p: LoadProgress) => void): () => void;
  detectSpeech(chunk16k: Float32Array): Promise<boolean>;
  transcribe(
    frames: VoiceFrames,
    onInterim?: (text: string) => void,
  ): Promise<string>;
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
  let readySettled = false;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Nobody may ever call ready() (e.g. the caller only uses
  // detectSpeech/transcribe, or close() lands before ready/error arrives).
  // Silence the default "unhandled rejection" for that case; callers that DO
  // call ready() still get the rejection via their own .then/.catch/await —
  // attaching a handler here doesn't consume it for other listeners.
  readyPromise.catch(() => {});

  let closed = false;

  let nextId = 1;
  const pendingDetect = new Map<number, Pending<boolean>>();
  const pendingTranscribe = new Map<number, Pending<string>>();
  // D6: id-correlated interim-text forwarding — one entry per in-flight
  // transcribe() call that supplied an onInterim callback, deleted the
  // moment that id settles (transcribeResult/error) or on close(). NOT a
  // Set-based multi-subscriber (unlike progressListeners): interim text is
  // inherently per-request, and two concurrent transcribe() calls (e.g. a
  // back-to-back gesture, spec §7.1 (d)) must never cross-deliver.
  const interimListeners = new Map<number, (text: string) => void>();

  worker.onmessage = (event: MessageEvent<SttWorkerResponse>) => {
    const msg = event.data;
    if (msg.kind === 'progress') {
      for (const cb of progressListeners)
        cb({ loaded: msg.loaded, total: msg.total });
      return;
    }
    if (msg.kind === 'ready') {
      readySettled = true;
      readyResolve();
      return;
    }
    if (msg.kind === 'detectSpeechResult') {
      pendingDetect.get(msg.id)?.resolve(msg.isSpeech);
      pendingDetect.delete(msg.id);
      return;
    }
    if (msg.kind === 'transcribeInterim') {
      interimListeners.get(msg.id)?.(msg.text);
      return;
    }
    if (msg.kind === 'transcribeResult') {
      pendingTranscribe.get(msg.id)?.resolve(msg.text);
      pendingTranscribe.delete(msg.id);
      interimListeners.delete(msg.id);
      return;
    }
    if (msg.kind === 'error') {
      if (msg.id !== undefined) {
        pendingDetect.get(msg.id)?.reject(new Error(msg.message));
        pendingDetect.delete(msg.id);
        pendingTranscribe.get(msg.id)?.reject(new Error(msg.message));
        pendingTranscribe.delete(msg.id);
        interimListeners.delete(msg.id);
      } else {
        readySettled = true;
        readyReject(new Error(msg.message));
      }
    }
  };

  worker.postMessage({
    kind: 'load',
    model: cfg.model,
  } satisfies SttWorkerRequest);

  function ready(): Promise<void> {
    if (closed) return Promise.reject(new Error('stt-engine closed'));
    return readyPromise;
  }

  function onProgress(cb: (p: LoadProgress) => void): () => void {
    progressListeners.add(cb);
    return () => progressListeners.delete(cb);
  }

  function detectSpeech(chunk16k: Float32Array): Promise<boolean> {
    if (closed) return Promise.reject(new Error('stt-engine closed'));
    const id = nextId++;
    return new Promise<boolean>((resolve, reject) => {
      pendingDetect.set(id, { resolve, reject });
      // NO transfer list here (unlike transcribe below): detectSpeech is
      // classify-only and the caller (use-voice-input.ts tap path) reuses
      // this SAME chunk for segmenter.pushFrame immediately after. A
      // transfer would DETACH the caller's view → an empty buffer gets
      // segmented → vad.ts concat() breaks. Send it by structured-clone.
      worker.postMessage({
        kind: 'detectSpeech',
        id,
        chunk: chunk16k,
      } satisfies SttWorkerRequest);
    });
  }

  function transcribe(
    frames: VoiceFrames,
    onInterim?: (text: string) => void,
  ): Promise<string> {
    if (closed) return Promise.reject(new Error('stt-engine closed'));
    const id = nextId++;
    if (onInterim) interimListeners.set(id, onInterim);
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
    if (closed) return;
    closed = true;
    const closeErr = new Error('stt-engine closed');
    for (const pending of pendingDetect.values()) pending.reject(closeErr);
    for (const pending of pendingTranscribe.values()) pending.reject(closeErr);
    pendingDetect.clear();
    pendingTranscribe.clear();
    interimListeners.clear();
    if (!readySettled) {
      readySettled = true;
      readyReject(closeErr);
    }
    worker.terminate();
    progressListeners.clear();
  }

  return { ready, onProgress, detectSpeech, transcribe, close };
}
