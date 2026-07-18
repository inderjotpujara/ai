import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioCapture } from './audio-capture.ts';
import { createSttEngine, ModelTier, type SttEngine } from './stt-engine.ts';
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

const MODEL: ModelTier = ModelTier.Base;

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
    const { capture, stopMock, emitChunk, chunkListenerCount } =
      makeFakeCapture();
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

  it('a quick startHold→stopHold before capture.start() resolves lands on ready (not a phantom listening) and stops the superseded capture — no hot mic (Fix 2)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const startGate = deferred<void>();
    const stopMock = vi.fn(async () => {});
    const capture: AudioCapture = {
      start: vi.fn(() => startGate.promise),
      stop: stopMock,
      onChunk: () => () => {},
      onLevel: () => () => {},
      active: true,
    };
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold()); // start() called, still pending
    act(() => result.current.stopHold()); // supersedes: captureRef nulled, stop() fired
    // getUserMedia resolves LATE, after the gesture was already released:
    await act(async () => {
      startGate.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('ready'); // NOT 'listening'
    expect(stopMock).toHaveBeenCalled(); // superseded capture stopped — mic not left live
  });

  it('tap-mode: out-of-order detectSpeech resolution still processes chunks in arrival order (serialized queue, Fix 3)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const detectCalls: Array<{
      chunk: Float32Array;
      resolve: (b: boolean) => void;
    }> = [];
    engine.detectSpeech = vi.fn(
      (chunk: Float32Array) =>
        new Promise<boolean>((resolve) => {
          detectCalls.push({ chunk, resolve });
        }),
    );
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
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    const chunkA = new Float32Array([0.11]);
    const chunkB = new Float32Array([0.22]);
    await act(async () => {
      emitChunk(chunkA);
      emitChunk(chunkB);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Serialized: chunk B's detectSpeech is NOT invoked until chunk A's
    // round-trip resolves. A parallel (pre-fix) pipeline would have fired
    // both immediately.
    expect(engine.detectSpeech).toHaveBeenCalledTimes(1);
    expect(detectCalls).toHaveLength(1);
    expect(detectCalls[0]?.chunk).toBe(chunkA);
    await act(async () => {
      detectCalls[0]?.resolve(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(engine.detectSpeech).toHaveBeenCalledTimes(2);
    expect(detectCalls[1]?.chunk).toBe(chunkB); // arrival order preserved
  });

  it('a teardown (disable) while transcribe is in flight never delivers the late final and lands on disabled (Fix 4)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const transcribeGate = deferred<string>();
    engine.transcribe = vi.fn(() => transcribeGate.promise);
    const { capture, emitChunk } = makeFakeCapture();
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
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold()); // flush → transcribe in flight (pending)
    await waitFor(() => expect(engine.transcribe).toHaveBeenCalledTimes(1));
    rerender({ enabled: false }); // teardown while transcribe pending
    await waitFor(() => expect(result.current.status).toBe('disabled'));
    await act(async () => {
      transcribeGate.resolve('late text');
      await Promise.resolve();
    });
    expect(onFinal).not.toHaveBeenCalled(); // late final swallowed
    expect(result.current.status).toBe('disabled'); // status not repainted
  });

  it('a teardown (unmount) while transcribe is in flight never delivers the late final or setState post-unmount (Fix 4)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const transcribeGate = deferred<string>();
    engine.transcribe = vi.fn(() => transcribeGate.promise);
    const { capture, emitChunk } = makeFakeCapture();
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
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(engine.transcribe).toHaveBeenCalledTimes(1));
    unmount(); // teardown while transcribe pending
    await act(async () => {
      transcribeGate.resolve('late text');
      await Promise.resolve();
    });
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('back-to-back gestures: a first utterance whose transcribe is still in flight when a SECOND gesture starts is NOT dropped — its final still lands (per-session validity set)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    const firstGate = deferred<string>();
    let transcribeCall = 0;
    engine.transcribe = vi.fn(() => {
      transcribeCall += 1;
      // First gesture's transcribe is deferred (still in flight when gesture
      // 2 begins); the second resolves normally.
      return transcribeCall === 1 ? firstGate.promise : Promise.resolve('two');
    });
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

    // Gesture 1: speak, release → transcribe1 fires but stays pending.
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(engine.transcribe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Gesture 2 starts BEFORE transcribe1 has resolved.
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));

    // Now transcribe1 resolves — its final must STILL be delivered (append
    // semantics) and must NOT stomp gesture 2's live 'listening' status.
    await act(async () => {
      firstGate.resolve('one');
      await Promise.resolve();
    });
    expect(onFinal).toHaveBeenCalledWith('one'); // first utterance NOT dropped
    expect(result.current.status).toBe('listening'); // gesture 2 still live

    // Gesture 2 still works end-to-end and delivers its own final.
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(engine.transcribe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('two'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(onFinal).toHaveBeenCalledTimes(2);
  });

  it('streams real interim text from engine.transcribe (hold-to-talk), replacing the "…" placeholder (D6)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {}); // never resolves — interim-only in this test
    });
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
    await waitFor(() => expect(result.current.interim).toBe('…'));
    act(() => capturedOnInterim?.('Hel'));
    await waitFor(() => expect(result.current.interim).toBe('Hel'));
    act(() => capturedOnInterim?.('Hello'));
    await waitFor(() => expect(result.current.interim).toBe('Hello'));
  });

  it('streams real interim text via VAD tap-to-toggle too (D6)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    engine.detectSpeech = vi.fn(async () => true);
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {});
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 10, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    await act(async () => {
      emitChunk(new Float32Array(512));
      await Promise.resolve();
    });
    await act(async () => {
      result.current.toggleTap();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.interim).toBe('…'));
    act(() => capturedOnInterim?.('world'));
    await waitFor(() => expect(result.current.interim).toBe('world'));
  });

  it('interim text is always a monotonic replace — every message is the full running text, never a shorter fragment (§7.1 b)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {});
    });
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
    const seen: string[] = [];
    for (const chunk of ['Hel', 'Hello', 'Hello world']) {
      act(() => capturedOnInterim?.(chunk));
      await waitFor(() => expect(result.current.interim).toBe(chunk));
      seen.push(result.current.interim);
    }
    // Each observed value is a prefix-superset of the previous one — never
    // shorter, never a different branch (a decode-restart artifact).
    expect(seen).toEqual(['Hel', 'Hello', 'Hello world']);
    expect(seen.every((s, i) => i === 0 || s.startsWith(''))).toBe(true);
    expect(seen[2]?.startsWith('Hello')).toBe(true);
  });

  it('§7.1 (a): interim messages for a segmenter invalidated by a destructive teardown are dropped, never displayed', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {}); // never resolves
    });
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
    act(() => result.current.stopHold()); // flushes → transcribe() starts, interim '…'
    await waitFor(() => expect(result.current.interim).toBe('…'));

    // Start a NEW gesture and cancel it — this is the destructive path that
    // clears validSegmentersRef.current entirely (Fix 4), invalidating the
    // FIRST segment's still-in-flight transcribe too.
    act(() => result.current.startHold());
    act(() => result.current.cancel());

    const interimAtCancel = result.current.interim;
    act(() => capturedOnInterim?.('should-not-appear'));
    expect(result.current.interim).toBe(interimAtCancel);
    expect(result.current.interim).not.toBe('should-not-appear');
  });

  it("§7.1 (d): a back-to-back gesture never shows the OLD segment's late interim as if it were the NEW segment's", async () => {
    const { engine, readyGate } = makeFakeEngine();
    const captured: Array<(text: string) => void> = [];
    engine.transcribe = vi.fn((_frames, onInterim) => {
      if (onInterim) captured.push(onInterim);
      return new Promise<string>(() => {}); // neither segment's decode ever resolves
    });
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

    // Segment A: hold, release (graceful stop — stays VALID for its final).
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(result.current.interim).toBe('…'));
    const onInterimA = captured[0];
    act(() => onInterimA?.('A-partial'));
    await waitFor(() => expect(result.current.interim).toBe('A-partial'));

    // Segment B starts BEFORE A's decode resolves — a genuine back-to-back
    // gesture. B becomes segmenterRef.current; A is still in
    // validSegmentersRef (graceful stop), so A's FINAL would still be
    // allowed to land later — but A's INTERIM must not bleed into B's slot.
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() => expect(result.current.interim).toBe('…'));

    // A's decode is STILL in flight and fires another interim chunk late —
    // this must never overwrite B's display.
    act(() => onInterimA?.('A-partial-late'));
    expect(result.current.interim).toBe('…'); // still B's placeholder, not A's text

    const onInterimB = captured[1];
    act(() => onInterimB?.('B-partial'));
    await waitFor(() => expect(result.current.interim).toBe('B-partial'));
    act(() => onInterimA?.('A-partial-even-later'));
    expect(result.current.interim).toBe('B-partial'); // still B's, A never bleeds in
  });

  it('§7.1 (c): the final transcribeResult always wins over a late-arriving interim for the same request id', async () => {
    const { engine, readyGate } = makeFakeEngine();
    let capturedOnInterim: ((text: string) => void) | undefined;
    const transcribeGate = deferred<string>();
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return transcribeGate.promise;
    });
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
    await waitFor(() => expect(result.current.interim).toBe('…'));

    act(() => capturedOnInterim?.('partial'));
    await waitFor(() => expect(result.current.interim).toBe('partial'));

    // The final resolves — interim is cleared, onFinal fires.
    act(() => transcribeGate.resolve('final text'));
    await waitFor(() => expect(onFinal).toHaveBeenCalledWith('final text'));
    await waitFor(() => expect(result.current.interim).toBe(''));

    // A LATE interim for the SAME (already-settled) request id must not
    // stomp the cleared, finalized state.
    act(() => capturedOnInterim?.('late-after-final'));
    expect(result.current.interim).toBe('');
  });

  // ------------------------------------------------------------------
  // §7.1 VAD tap-toggle correlation (per-SEGMENT, not per-segmenter).
  //
  // A tap-toggle gesture's SINGLE segmenter emits MANY segments (one per
  // speech→silence cycle). The §7.1 guards must therefore correlate on a
  // per-segment token, not on the segmenter object — otherwise segment 1's
  // settled transcribe would invalidate segment 2 of the SAME live gesture.
  // ------------------------------------------------------------------

  // Drain the async tap-mode serialization queue (each chunk awaits an
  // async detectSpeech round-trip before pushFrame).
  async function drainTapQueue(ticks = 8) {
    for (let i = 0; i < ticks; i++) await Promise.resolve();
  }

  it('§7.1 Critical #1: a tap-toggle gesture emitting TWO segments delivers the SECOND segment’s onFinal AND streams its interim (per-segment token, not per-segmenter)', async () => {
    const { engine, readyGate } = makeFakeEngine();
    // Content-based VAD: a non-zero chunk is speech, a zero chunk is silence.
    engine.detectSpeech = vi.fn(async (chunk: Float32Array) =>
      chunk.some((v) => v !== 0),
    );
    const gates: Array<ReturnType<typeof deferred<string>>> = [];
    const interimCbs: Array<((text: string) => void) | undefined> = [];
    engine.transcribe = vi.fn((_frames, onInterim) => {
      const gate = deferred<string>();
      gates.push(gate);
      interimCbs.push(onInterim);
      return gate.promise;
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 10, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));

    const speech = () => new Float32Array(8000).fill(0.5); // 500ms speech
    const silence = () => new Float32Array(8000); // 500ms silence ≥ silenceMs

    // Cycle 1: speech then silence → segment 1 closes and begins transcribing.
    await act(async () => {
      emitChunk(speech());
      await drainTapQueue();
      emitChunk(silence());
      await drainTapQueue();
    });
    await waitFor(() => expect(gates).toHaveLength(1));

    // Segment 1's final resolves — its transcribe SETTLES (its finally deletes
    // segment 1's token). On the pre-fix per-segmenter code this deletes the
    // one shared segmenter, poisoning segment 2 below.
    await act(async () => {
      gates[0]?.resolve('one');
      await drainTapQueue();
    });
    expect(onFinal).toHaveBeenCalledWith('one');

    // Cycle 2 of the SAME still-active tap gesture → segment 2.
    await act(async () => {
      emitChunk(speech());
      await drainTapQueue();
      emitChunk(silence());
      await drainTapQueue();
    });
    await waitFor(() => expect(gates).toHaveLength(2));

    // Segment 2's interim MUST stream (pre-fix: dropped — segmenter deleted).
    act(() => interimCbs[1]?.('seg2-partial'));
    await waitFor(() => expect(result.current.interim).toBe('seg2-partial'));

    // Segment 2's final MUST be delivered (pre-fix: early-returned, lost).
    await act(async () => {
      gates[1]?.resolve('two');
      await drainTapQueue();
    });
    expect(onFinal).toHaveBeenCalledWith('two');
    expect(onFinal).toHaveBeenCalledTimes(2);
  });

  it('§7.1 Critical #2: two overlapping segments of ONE tap gesture — an older segment’s late interim never paints over the newer segment’s, and the display stays monotonic', async () => {
    const { engine, readyGate } = makeFakeEngine();
    engine.detectSpeech = vi.fn(async (chunk: Float32Array) =>
      chunk.some((v) => v !== 0),
    );
    const interimCbs: Array<((text: string) => void) | undefined> = [];
    engine.transcribe = vi.fn((_frames, onInterim) => {
      interimCbs.push(onInterim);
      return new Promise<string>(() => {}); // neither segment’s decode resolves
    });
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 10, onFinal },
        { createCapture: () => capture, createEngine: () => engine },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));

    const speech = () => new Float32Array(8000).fill(0.5);
    const silence = () => new Float32Array(8000);

    // Segment 1 begins transcribing (its decode stays in flight).
    await act(async () => {
      emitChunk(speech());
      await drainTapQueue();
      emitChunk(silence());
      await drainTapQueue();
    });
    await waitFor(() => expect(interimCbs).toHaveLength(1));
    act(() => interimCbs[0]?.('A-partial'));
    await waitFor(() => expect(result.current.interim).toBe('A-partial'));

    // Segment 2 of the SAME gesture begins — it now owns the display.
    await act(async () => {
      emitChunk(speech());
      await drainTapQueue();
      emitChunk(silence());
      await drainTapQueue();
    });
    await waitFor(() => expect(interimCbs).toHaveLength(2));
    await waitFor(() => expect(result.current.interim).toBe('…'));

    // Segment 1 (older, SAME segmenter) fires a late interim — pre-fix this
    // painted over segment 2 because the per-segmenter guard cannot tell two
    // segments of one segmenter apart. Post-fix the per-segment token drops it.
    act(() => interimCbs[0]?.('A-partial-late'));
    expect(result.current.interim).toBe('…');

    act(() => interimCbs[1]?.('B-partial'));
    await waitFor(() => expect(result.current.interim).toBe('B-partial'));
    act(() => interimCbs[0]?.('A-partial-even-later'));
    expect(result.current.interim).toBe('B-partial'); // monotonic, no bleed
  });

  it('§7.1 (a) tap variant: interim of a tap segment invalidated by a destructive teardown (cancel) is dropped', async () => {
    const { engine, readyGate } = makeFakeEngine();
    engine.detectSpeech = vi.fn(async () => true);
    let capturedOnInterim: ((text: string) => void) | undefined;
    engine.transcribe = vi.fn((_frames, onInterim) => {
      capturedOnInterim = onInterim;
      return new Promise<string>(() => {}); // never resolves
    });
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
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    await act(async () => {
      emitChunk(new Float32Array(512).fill(0.5));
      await drainTapQueue();
    });
    // toggleTap again → flush → segment emitted, transcribe starts, interim '…'.
    await act(async () => {
      result.current.toggleTap();
      await drainTapQueue();
    });
    await waitFor(() => expect(result.current.interim).toBe('…'));

    // Destructive teardown: start a new gesture then cancel → clears ALL tokens.
    act(() => result.current.startHold());
    act(() => result.current.cancel());

    const interimAtCancel = result.current.interim;
    act(() => capturedOnInterim?.('should-not-appear'));
    expect(result.current.interim).toBe(interimAtCancel);
    expect(result.current.interim).not.toBe('should-not-appear');
  });

  it("§7.1 (d) tap variant: back-to-back tap gestures never show the OLD tap segment's late interim as the NEW one's", async () => {
    const { engine, readyGate } = makeFakeEngine();
    engine.detectSpeech = vi.fn(async () => true);
    const captured: Array<(text: string) => void> = [];
    engine.transcribe = vi.fn((_frames, onInterim) => {
      if (onInterim) captured.push(onInterim);
      return new Promise<string>(() => {}); // neither decode resolves
    });
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

    // Tap gesture A: start, speak, stop (graceful — A stays valid for its final).
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    await act(async () => {
      emitChunk(new Float32Array(512).fill(0.5));
      await drainTapQueue();
    });
    await act(async () => {
      result.current.toggleTap();
      await drainTapQueue();
    });
    await waitFor(() => expect(result.current.interim).toBe('…'));
    const onInterimA = captured[0];
    act(() => onInterimA?.('A-partial'));
    await waitFor(() => expect(result.current.interim).toBe('A-partial'));

    // Tap gesture B starts before A's decode resolves.
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    await act(async () => {
      emitChunk(new Float32Array(512).fill(0.5));
      await drainTapQueue();
    });
    await act(async () => {
      result.current.toggleTap();
      await drainTapQueue();
    });
    await waitFor(() => expect(result.current.interim).toBe('…'));

    act(() => onInterimA?.('A-partial-late'));
    expect(result.current.interim).toBe('…'); // still B's placeholder

    const onInterimB = captured[1];
    act(() => onInterimB?.('B-partial'));
    await waitFor(() => expect(result.current.interim).toBe('B-partial'));
    act(() => onInterimA?.('A-partial-even-later'));
    expect(result.current.interim).toBe('B-partial'); // A never bleeds in
  });

  it('a completed transcription emits a computed telemetry beacon via deps.emitTelemetry (D10)', async () => {
    const { engine, readyGate, transcribeMock } = makeFakeEngine();
    transcribeMock.mockResolvedValue('hello there world');
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const emitTelemetry = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        {
          createCapture: () => capture,
          createEngine: () => engine,
          emitTelemetry,
        },
      ),
    );
    act(() => readyGate.resolve());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.startHold());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    act(() => emitChunk(new Float32Array(512)));
    act(() => result.current.stopHold());
    await waitFor(() =>
      expect(onFinal).toHaveBeenCalledWith('hello there world'),
    );
    await waitFor(() => expect(emitTelemetry).toHaveBeenCalledTimes(1));
    // biome-ignore lint/style/noNonNullAssertion: emitTelemetry is guaranteed called — we just asserted it above
    const event = emitTelemetry.mock.calls[0]![0];
    expect(event.kind).toBe('voice.transcribe.web');
    expect(event.modelTier).toBe(MODEL);
    expect(event.wordCount).toBe(3);
    expect(Number.isFinite(event.realTimeFactor)).toBe(true);
    expect(event.realTimeFactor).toBeGreaterThanOrEqual(0);
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

/** Auto-responding fake `Worker` that faithfully mimics real
 *  `Worker.postMessage` TRANSFER semantics — a buffer in the transfer list is
 *  DETACHED on the sender side. This lets a hook-level integration test drive
 *  the REAL `createSttEngine` and prove Fix 1 end-to-end: pre-fix the
 *  detectSpeech transfer detaches the chunk the tap pipeline reuses, so the
 *  segment concatenates an empty buffer; post-fix the chunk stays intact. The
 *  response payload is computed from what the receiver sees BEFORE detaching. */
class AutoWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  // biome-ignore lint/suspicious/noExplicitAny: minimal message-protocol fake
  postMessage(msg: any, transfer?: Transferable[]) {
    // biome-ignore lint/suspicious/noExplicitAny: minimal message-protocol fake
    let response: any;
    if (msg.kind === 'load') response = { kind: 'ready' };
    else if (msg.kind === 'detectSpeech') {
      const isSpeech = (msg.chunk as Float32Array).some((v) => v !== 0);
      response = { kind: 'detectSpeechResult', id: msg.id, isSpeech };
    } else if (msg.kind === 'transcribe') {
      const len = (msg.samples as Float32Array).length;
      response = { kind: 'transcribeResult', id: msg.id, text: `len:${len}` };
    }
    if (transfer) {
      for (const t of transfer) {
        if (t instanceof ArrayBuffer) structuredClone(t, { transfer: [t] });
      }
    }
    if (response) {
      queueMicrotask(() => {
        if (!this.terminated)
          this.onmessage?.({ data: response } as MessageEvent);
      });
    }
  }
  terminate() {
    this.terminated = true;
  }
}

describe('useVoiceInput — tap-mode Transferable-detach integration (Fix 1, real engine)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          // biome-ignore lint/correctness/noConstructorReturn: standard `new Worker()`-substitution idiom for mocking a global constructor
          return new AutoWorker() as unknown as Worker;
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a tap segment survives the engine round-trip with its audio intact — the reused chunk is not detached by detectSpeech (Fix 1)', async () => {
    const { capture, emitChunk } = makeFakeCapture();
    const onFinal = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput(
        { enabled: true, model: MODEL, silenceMs: 500, onFinal },
        { createCapture: () => capture, createEngine: createSttEngine },
      ),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.toggleTap());
    await waitFor(() => expect(result.current.status).toBe('listening'));
    // 500ms of speech (all-0.5) then 500ms of silence (all-0, >= silenceMs)
    // → the tap segmenter closes exactly one segment.
    await act(async () => {
      emitChunk(new Float32Array(8000).fill(0.5));
      await Promise.resolve();
    });
    await act(async () => {
      emitChunk(new Float32Array(8000));
      await Promise.resolve();
    });
    await waitFor(() => expect(onFinal).toHaveBeenCalledTimes(1));
    // The intact 8000-sample speech chunk reached transcribe. Pre-fix the
    // detectSpeech transfer would have detached the reused chunk → 'len:0'.
    expect(onFinal).toHaveBeenCalledWith('len:8000');
  });
});
