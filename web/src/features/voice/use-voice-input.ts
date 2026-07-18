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
  // The latest segment to BEGIN transcribing (set when its '…' placeholder is
  // painted in onSegment), independent of whether a gesture is still active.
  // §7.1 (d) gates interim display on THIS, not `segmenterRef` — a graceful
  // stop nulls `segmenterRef` before the still-valid transcription's interim
  // arrives, so gating interim on `segmenterRef` would wrongly drop the
  // current transcription's own interim. Gating on the latest transcribing
  // segment keeps the current one's interim while dropping an OLD, superseded
  // segment's late interim in a back-to-back gesture (no cross-bleed).
  const latestSegmentRef = useRef<Segmenter | null>(null);
  // Validity SET of "whose transcribe results are still wanted" — one entry
  // per still-live segmenter, NOT a single latest-wins token. A segmenter is
  // ADDED at gesture start and stays valid across a GRACEFUL stop
  // (stopHold/toggleTap) so its flush's final IS delivered — even if a NEWER
  // gesture has since started (back-to-back push-to-talk: a prior in-flight
  // transcribe must still land, not be dropped because it was superseded).
  // Each segmenter is REMOVED once its transcribe settles (bounded growth); a
  // DESTRUCTIVE teardown (cancel / disable / unmount) CLEARS the whole set so
  // no in-flight tail can deliver onFinal, repaint status, or setState after
  // the session ended (Fix 4 + back-to-back regression fix).
  const validSegmentersRef = useRef<Set<Segmenter>>(new Set());
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
      validSegmentersRef.current.clear(); // invalidate ALL in-flight transcribe tails (Fix 4)
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
      // ADD (do NOT clear) — a prior gesture's in-flight transcribe must stay
      // valid so its final still lands even as this newer gesture supersedes
      // it in segmenterRef.
      validSegmentersRef.current.add(segmenter);

      const offSegment = segmenter.onSegment((frames) => {
        setStatus('transcribing');
        setInterim('…');
        // This segment is now the most recent to begin transcribing — its
        // interim owns the composer until a newer segment supersedes it.
        latestSegmentRef.current = segmenter;
        // §7.1 (c): a settled final (or failure) always wins over a late
        // interim for THIS request. Checked first so a straggling interim
        // after the promise settles short-circuits before consulting the
        // validity set / latest-segment ref — both of which a subsequent
        // gesture may already have reused.
        let finalized = false;
        engine
          .transcribe(frames, (text) => {
            // D6: real streamed interim text replaces the static '…'
            // placeholder as Moonshine decodes, behind three adversarial
            // guards (§7.1):
            if (finalized) return; // (c) final wins over a late interim
            if (!validSegmentersRef.current.has(segmenter)) return; // (a) drop interim of a segmenter invalidated by a destructive teardown
            if (latestSegmentRef.current !== segmenter) return; // (d) never bleed an OLD segment's interim into a newer gesture's display
            setInterim(text);
          })
          .then((text) => {
            finalized = true;
            // Gate every side effect on PER-SESSION validity: a destructive
            // teardown (cancel/disable/unmount) cleared the set, so a late
            // resolve must NOT deliver onFinal, repaint status, or setState
            // post-unmount. A graceful stop keeps this segmenter valid — so
            // its flush's final still lands here EVEN IF a newer gesture has
            // since started (back-to-back push-to-talk). Status is derived
            // from the CURRENT gestureRef so a superseded final never stomps
            // a live gesture's state back to 'ready'.
            if (!validSegmentersRef.current.has(segmenter)) return;
            if (text) opts.onFinal(text);
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          })
          .catch(() => {
            finalized = true;
            if (!validSegmentersRef.current.has(segmenter)) return;
            setError('transcription failed');
            setInterim('');
            setStatus(gestureRef.current ? 'listening' : 'ready');
          })
          .finally(() => {
            // Bounded growth: drop this segmenter once its transcribe has
            // settled so the set can't accumulate across many gestures.
            validSegmentersRef.current.delete(segmenter);
          });
      });

      const capture = deps.createCapture();
      captureRef.current = capture;
      // Tap-mode serialization queue (Fix 3): each tap chunk must be
      // classified by the async `detectSpeech()` worker round-trip before
      // segmentation, and those round-trips can resolve OUT OF submission
      // order. A serial promise chain — await each chunk's classify +
      // pushFrame before the next chunk's detection starts — guarantees
      // pushFrame runs in ARRIVAL order (serial await is fine at VAD
      // cadence). Local to this gesture, so a new gesture starts fresh.
      let tapQueue: Promise<void> = Promise.resolve();
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
        tapQueue = tapQueue.then(async () => {
          if (segmenterRef.current !== segmenter) return; // gesture ended
          let isSpeech = false;
          try {
            isSpeech = await engine.detectSpeech(chunk);
          } catch {
            isSpeech = false;
          }
          if (segmenterRef.current !== segmenter) return; // ended mid round-trip
          // Defensive: this is the one SYNC call in the serial queue chain. A
          // throw here would reject tapQueue, poisoning every subsequent link
          // and surfacing as an unhandled rejection. Swallow it to a no-op for
          // this chunk so a single bad frame can't kill the whole gesture's
          // queue.
          try {
            segmenter.pushFrame(chunk, isSpeech);
          } catch {
            /* drop this chunk; keep the queue alive */
          }
        });
      });
      const offLevel = capture.onLevel((rms) => setLevel(rms));
      unsubRef.current = () => {
        offSegment();
        offChunk();
        offLevel();
      };

      capture
        .start()
        .then(() => {
          // Guard the deferred resolve on capture identity (Fix 2): a quick
          // press+release (or double toggleTap) before getUserMedia
          // resolves supersedes this capture — stopHold/endGesture already
          // nulled captureRef and called stop() (a NO-OP while start() was
          // still pending). If we blindly setStatus('listening') here we'd
          // paint a phantom listening state with no session AND leave the
          // real mic LIVE (hot-mic leak). So bail and stop the superseded
          // capture; a later gesture then owns captureRef cleanly.
          if (captureRef.current !== capture) {
            void capture.stop();
            return;
          }
          setStatus('listening');
        })
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
    [opts.silenceMs, opts.onFinal, endGesture, deps.createCapture],
  );

  const startHold = useCallback(() => startGesture('hold'), [startGesture]);

  const stopHold = useCallback(() => {
    if (gestureRef.current !== 'hold') return;
    // Accepted release-boundary behavior: a sub-chunk the worklet posted but
    // whose onChunk message hasn't dispatched at this exact stopHold instant
    // is dropped (it never reached the segmenter). Fine — the residual is
    // sub-frame audio, and flush() below preserves everything already buffered.
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
    validSegmentersRef.current.clear(); // invalidate ALL in-flight transcribe tails (Fix 4)
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
