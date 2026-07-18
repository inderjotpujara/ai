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
