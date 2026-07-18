import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AudioCapture } from './audio-capture.ts';
import { ModelTier, type SttEngine } from './stt-engine.ts';
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
