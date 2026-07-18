### Task 12: `use-voice-input.ts` — orchestrator hook (worker lifecycle, both gestures, concurrent-gesture guard, teardown)

**Files:**
- Create: `web/src/features/voice/use-voice-input.ts`
- Test: `web/src/features/voice/use-voice-input.test.ts`

**Interfaces:**
- Consumes:
  - `AudioCapture`, `createAudioCapture` from `web/src/features/voice/audio-capture.ts` (Part A Task ~5/6).
  - `SttEngine`, `ModelTier`, `createSttEngine` from `web/src/features/voice/stt-engine.ts` (Part A Task ~8/9).
  - `createSegmenter` from `./vad.ts` (Task 10/11, this file's own directory).
- Produces (locked, verbatim — consumed by Task 14's `mic-button.tsx`):
  ```ts
  export type VoiceStatus = 'disabled' | 'loading' | 'ready' | 'listening' | 'transcribing' | 'error';
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
  export type VoiceInputDeps = {
    createCapture: () => AudioCapture;
    createEngine: (cfg: { model: ModelTier }) => SttEngine;
  };
  export function useVoiceInput(opts: UseVoiceInputOpts, deps?: VoiceInputDeps): UseVoiceInput;
  ```
  The `deps` second parameter (defaulting to the real `createAudioCapture`/`createSttEngine`) is the test seam — no test in this task ever touches a real `getUserMedia`/`Worker`/`AudioContext`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/voice/use-voice-input.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AudioCapture } from './audio-capture.ts';
import type { ModelTier, SttEngine } from './stt-engine.ts';
import { useVoiceInput } from './use-voice-input.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFakeCapture() {
  const chunkListeners = new Set<(chunk: Float32Array) => void>();
  const levelListeners = new Set<(rms: number) => void>();
  const startMock = vi.fn(async () => {});
  const stopMock = vi.fn(async () => {});
  const capture: AudioCapture = {
    start: startMock,
    stop: stopMock,
    onChunk: (cb) => {
      chunkListeners.add(cb);
      return () => chunkListeners.delete(cb);
    },
    onLevel: (cb) => {
      levelListeners.add(cb);
      return () => levelListeners.delete(cb);
    },
    active: true,
  };
  return {
    capture,
    startMock,
    stopMock,
    emitChunk: (chunk: Float32Array) => {
      for (const cb of chunkListeners) cb(chunk);
    },
    chunkListenerCount: () => chunkListeners.size,
  };
}

function makeFakeEngine() {
  const readyGate = deferred<void>();
  const transcribeMock = vi.fn(async () => 'hello world');
  const detectSpeechMock = vi.fn(async () => false);
  const closeMock = vi.fn();
  const engine: SttEngine = {
    ready: () => readyGate.promise,
    onProgress: () => () => {},
    detectSpeech: detectSpeechMock,
    transcribe: transcribeMock,
    close: closeMock,
  };
  return { engine, readyGate, transcribeMock, detectSpeechMock, closeMock };
}

const MODEL: ModelTier = 'moonshine-base';

describe('useVoiceInput', () => {
  it('a mic press before the engine reports ready is a no-op (§7.2 a)', () => {
    const { engine } = makeFakeEngine();
    const { capture, startMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    expect(result.current.status).toBe('loading');
    act(() => result.current.startHold());
    expect(startMock).not.toHaveBeenCalled();
  });

  it('engine.ready() resolving flips status to ready; a hold press then begins real capture', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture, startMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.ready).toBe(true);
    act(() => result.current.startHold());
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe('listening'));
  });

  it('rejects an overlapping gesture: a hold press while a tap-toggle session is already listening starts no second capture (§7.2 b)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture, startMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => result.current.startHold());
    expect(startMock).toHaveBeenCalledTimes(1); // second gesture ignored, not a second capture
  });

  it('a second toggleTap() while already listening (tap mode) stops the session instead of starting another', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture, startMock, stopMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(stopMock).toHaveBeenCalledTimes(1));
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('stopHold flushes the segmenter and hands the transcribed final text to onFinal', async () => {
    const { engine, readyGate, transcribeMock } = makeFakeEngine();
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(transcribeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('hello world'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('cancel() discards buffered audio without ever calling transcribe', async () => {
    const { engine, readyGate, transcribeMock } = makeFakeEngine();
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('disabling voice tears the session down: capture.stop() + engine.close() both fire, and a stray post-teardown chunk never reaches onFinal (§7.2 c)', async () => {
    const { engine, readyGate, closeMock } = makeFakeEngine();
    const { capture, stopMock, emitChunk, chunkListenerCount } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useVoiceInput(
          { enabled, model: MODEL, silenceMs: 500, onFinal },
          { createCapture: () => capture, createEngine: () => engine },
        ),
      { initialProps: { enabled: true } },
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    rerender({ enabled: false });
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(chunkListenerCount()).toBe(0);
    act(() => emitChunk(new Float32Array(512)));
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('unmounting mid-session also tears capture + engine down (same teardown path as disable)', async () => {
    const { engine, readyGate, closeMock } = makeFakeEngine();
    const { capture, stopMock } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    unmount();
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('a model-load failure degrades to an error status with a message, never a stuck loading state (§7.2 d)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.reject(new Error('WebGPU unsupported')));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('WebGPU unsupported');
  });

  it('a capture.start() rejection (mic permission denied) degrades to an error status, not a crash', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const { capture, startMock } = makeFakeCapture();
    startMock.mockRejectedValueOnce(new Error('Permission denied'));
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Permission denied');
  });

  it('when enabled is false from the start, status is disabled and no engine/capture is ever created', () => {
    const createEngine = vi.fn();
    const createCapture = vi.fn();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: false, model: MODEL, silenceMs: 500, onFinal },
        { createCapture, createEngine },
      ),
    );
    expect(result.current.status).toBe('disabled');
    expect(createEngine).not.toHaveBeenCalled();
    expect(createCapture).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun run test -- use-voice-input.test.ts`
Expected: FAIL — `Cannot find module './use-voice-input.ts'`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/voice/use-voice-input.ts`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioCapture, type AudioCapture } from './audio-capture.ts';
import { createSttEngine, type ModelTier, type SttEngine } from './stt-engine.ts';
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
  // round-trip (Settings, Task 15), not a live in-place model swap in v1.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          endGesture(readyRef.current ? 'ready' : 'error');
          setError(
            err instanceof Error ? err.message : 'microphone unavailable',
          );
        });
    },
    [opts.silenceMs, opts.onFinal, opts.onInterim, endGesture],
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun run test -- use-voice-input.test.ts`
Expected: PASS — 12/12.

- [ ] **Step 5: Gate + commit**

Run: `cd web && bun run typecheck && cd web && bun run lint`

```bash
git add web/src/features/voice/use-voice-input.ts web/src/features/voice/use-voice-input.test.ts
git commit -m "feat(voice): add useVoiceInput orchestrator hook (both gestures, ready-gating, teardown)"
```

---

