import { useCallback, useEffect, useRef, useState } from 'react';
import { type AudioCapture, createAudioCapture } from './audio-capture.ts';
import {
  createSttEngine,
  type ModelTier,
  type SttEngine,
} from './stt-engine.ts';
import { createSegmenter, type Segmenter } from './vad.ts';

export type VoiceStatus =
  | 'disabled'
  | 'loading'
  | 'ready'
  | 'listening'
  | 'transcribing'
  | 'error';

export type UseVoiceInput = {
  status: VoiceStatus;
  ready: boolean;
  level: number;
  interim: string;
  error?: string;
  startHold(): void;
  stopHold(): void;
  toggleTap(): void;
  cancel(): void;
};

export type UseVoiceInputOpts = {
  enabled: boolean;
  model: ModelTier;
  silenceMs: number;
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
};

/** Injected factories — the test seam. Real callers get the module
 *  defaults; tests substitute fakes so no test ever touches a real
 *  `getUserMedia`/`Worker`/`AudioContext`. */
export type VoiceInputDeps = {
  createCapture: () => AudioCapture;
  createEngine: (cfg: { model: ModelTier }) => SttEngine;
};

const DEFAULT_DEPS: VoiceInputDeps = {
  createCapture: createAudioCapture,
  createEngine: createSttEngine,
};

/** Nominal VAD analysis window (Silero's own default) — used only as
 *  `vad.ts`'s zero-length-chunk fallback duration, never as a hardcoded
 *  silence threshold (that's `opts.silenceMs`, config-sourced). */
const FRAME_MS = 32;

export function useVoiceInput(
  opts: UseVoiceInputOpts,
  deps: VoiceInputDeps = DEFAULT_DEPS,
): UseVoiceInput {
  const [status, setStatus] = useState<VoiceStatus>(
    opts.enabled ? 'loading' : 'disabled',
  );
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const engineRef = useRef<SttEngine | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const segmenterRef = useRef<Segmenter | null>(null);
  const gestureRef = useRef<'hold' | 'tap' | null>(null);
  const readyRef = useRef(false);
  const unsubRef = useRef<() => void>(() => {});

  // Worker lifecycle (§7.2): spawn once per enable, terminate on
  // disable/unmount. Re-running only on `opts.enabled` is deliberate —
  // changing the model tier while enabled requires a disable/enable
  // round-trip (Settings, Task 15), not a live in-place model swap in v1:
  // widening the deps below to opts.model/deps.createEngine would silently
  // respawn the worker mid-session on a model-tier change instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above — keyed on opts.enabled alone, deliberately.
  useEffect(() => {
    if (!opts.enabled) {
      setStatus('disabled');
      readyRef.current = false;
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(undefined);
    readyRef.current = false;
    const engine = deps.createEngine({ model: opts.model });
    engineRef.current = engine;
    engine
      .ready()
      .then(() => {
        if (cancelled) return;
        readyRef.current = true;
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(
          err instanceof Error ? err.message : 'voice model failed to load',
        );
      });
    return () => {
      cancelled = true;
      readyRef.current = false;
      unsubRef.current();
      unsubRef.current = () => {};
      if (captureRef.current) void captureRef.current.stop();
      captureRef.current = null;
      segmenterRef.current = null;
      gestureRef.current = null;
      engine.close();
      engineRef.current = null;
    };
  }, [opts.enabled]);

  const endGesture = useCallback((nextStatus: VoiceStatus) => {
    unsubRef.current();
    unsubRef.current = () => {};
    if (captureRef.current) void captureRef.current.stop();
    captureRef.current = null;
    segmenterRef.current = null;
    gestureRef.current = null;
    setLevel(0);
    setStatus(nextStatus);
  }, []);

  const startGesture = useCallback(
    (kind: 'hold' | 'tap') => {
      if (!readyRef.current || gestureRef.current) return; // §7.2 (a) + (b)
      const engine = engineRef.current;
      if (!engine) return;
      gestureRef.current = kind;

      const segmenter = createSegmenter({
        silenceMs: opts.silenceMs,
        gated: kind === 'tap',
        frameMs: FRAME_MS,
      });
      segmenterRef.current = segmenter;

      const offSegment = segmenter.onSegment((frames) => {
        setStatus('transcribing');
        setInterim('…');
        opts.onInterim?.('…');
        engine
          .transcribe(frames)
          .then((text) => {
            if (text) opts.onFinal(text);
          })
          .catch(() => setError('transcription failed'))
          .finally(() => {
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          });
      });

      const capture = deps.createCapture();
      captureRef.current = capture;
      const offChunk = capture.onChunk((chunk) => {
        // Hold-to-talk (`gated: false`) ignores `isSpeech` entirely — the
        // gesture itself is the segment boundary (vad.ts) — so push the
        // chunk synchronously. Routing it through the async
        // `detectSpeech()` round-trip first would open a microtask gap a
        // synchronous `stopHold()` → `flush()` can race past, silently
        // dropping the last-buffered chunk (caught live by this task's
        // own "stopHold flushes the segmenter" test). Tap-to-toggle
        // (`gated: true`) genuinely needs the speech/silence classification
        // to place segment boundaries, so it stays async.
        if (kind === 'hold') {
          segmenter.pushFrame(chunk, true);
          return;
        }
        engine
          .detectSpeech(chunk)
          .then((isSpeech) => segmenter.pushFrame(chunk, isSpeech))
          .catch(() => segmenter.pushFrame(chunk, false));
      });
      const offLevel = capture.onLevel((rms) => setLevel(rms));
      unsubRef.current = () => {
        offSegment();
        offChunk();
        offLevel();
      };

      capture
        .start()
        .then(() => setStatus('listening'))
        .catch((err: unknown) => {
          // Always land on 'error' here — a mic-permission denial must
          // never be swallowed back into 'ready' just because the STT
          // engine itself is still loaded. (The original ternary on
          // `readyRef.current` did exactly that, since the engine stays
          // ready across a failed capture start — a silent "you're fine"
          // status while the mic never actually opened, §7.2 d.)
          endGesture('error');
          setError(
            err instanceof Error ? err.message : 'microphone unavailable',
          );
        });
    },
    [
      opts.silenceMs,
      opts.onFinal,
      opts.onInterim,
      endGesture,
      deps.createCapture,
    ],
  );

  const startHold = useCallback(() => startGesture('hold'), [startGesture]);

  const stopHold = useCallback(() => {
    if (gestureRef.current !== 'hold') return;
    segmenterRef.current?.flush(); // §7.1 (c): never drop the release-boundary residual
    endGesture('ready');
  }, [endGesture]);

  const toggleTap = useCallback(() => {
    if (gestureRef.current === 'tap') {
      segmenterRef.current?.flush();
      endGesture('ready');
      return;
    }
    if (gestureRef.current === null) startGesture('tap');
    // gestureRef.current === 'hold': ignored — concurrent-gesture guard.
  }, [endGesture, startGesture]);

  const cancel = useCallback(() => {
    if (gestureRef.current === null) return;
    segmenterRef.current?.reset(); // discard buffered audio — never transcribe
    endGesture('ready');
  }, [endGesture]);

  return {
    status,
    ready: readyRef.current,
    level,
    interim,
    error,
    startHold,
    stopHold,
    toggleTap,
    cancel,
  };
}
