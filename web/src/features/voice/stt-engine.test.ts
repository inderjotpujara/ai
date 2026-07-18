import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelTier } from './model-tier.ts';
import type { SttWorkerResponse } from './stt.worker.ts';
import { createSttEngine } from './stt-engine.ts';

/** Minimal fake standing in for the real `Worker` global — captures every
 *  `postMessage` call and lets the test drive `onmessage` manually to
 *  simulate a worker response. Real transformers.js/WASM behavior is never
 *  exercised here (see Task 7's spike + Part B's live-verify for that);
 *  this suite only asserts the message PROTOCOL is correct. */
class FakeSttWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(response: SttWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent);
  }
}

let lastWorker: FakeSttWorker | undefined;

beforeEach(() => {
  lastWorker = undefined;
  vi.stubGlobal(
    'Worker',
    class {
      constructor(..._args: unknown[]) {
        const fake = new FakeSttWorker();
        lastWorker = fake;
        // biome-ignore lint/correctness/noConstructorReturn: standard `new Worker()`-substitution idiom for mocking a global constructor with a plain fake object
        return fake as unknown as Worker;
      }
    },
  );
});

describe('createSttEngine', () => {
  it('posts a load request for the configured model tier on construction', () => {
    createSttEngine({ model: ModelTier.Tiny });
    expect(lastWorker?.posted).toEqual([
      { kind: 'load', model: 'moonshine-tiny' },
    ]);
  });

  it('ready() resolves only once the worker reports ready, not before', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    let resolved = false;
    void engine.ready().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    lastWorker?.emit({ kind: 'ready' });
    await engine.ready();
    expect(resolved).toBe(true);
  });

  it('forwards progress messages to onProgress subscribers', () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const onProgress = vi.fn();
    engine.onProgress(onProgress);
    lastWorker?.emit({ kind: 'progress', loaded: 50, total: 100 });
    expect(onProgress).toHaveBeenCalledWith({ loaded: 50, total: 100 });
  });

  it('onProgress unsubscribe stops further callbacks', () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const onProgress = vi.fn();
    const unsubscribe = engine.onProgress(onProgress);
    unsubscribe();
    lastWorker?.emit({ kind: 'progress', loaded: 1, total: 2 });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('detectSpeech() resolves with the matching response by request id', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const resultPromise = engine.detectSpeech(new Float32Array([0.1, 0.2]));
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    expect(posted.kind).toBe('detectSpeech');
    lastWorker?.emit({
      kind: 'detectSpeechResult',
      id: posted.id,
      isSpeech: true,
    });
    expect(await resultPromise).toBe(true);
  });

  it('transcribe() resolves with the matching response by request id', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const resultPromise = engine.transcribe({
      samples: new Float32Array([0.1]),
      sampleRate: 16000,
    });
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    expect(posted.kind).toBe('transcribe');
    lastWorker?.emit({
      kind: 'transcribeResult',
      id: posted.id,
      text: 'hello world',
    });
    expect(await resultPromise).toBe('hello world');
  });

  it('two concurrent requests resolve independently, matched by their own id', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const first = engine.transcribe({
      samples: new Float32Array([0.1]),
      sampleRate: 16000,
    });
    const second = engine.transcribe({
      samples: new Float32Array([0.2]),
      sampleRate: 16000,
    });
    // biome-ignore lint/style/noNonNullAssertion: lastWorker is set synchronously by the stubbed Worker constructor above
    const [firstPosted, secondPosted] = lastWorker!.posted.slice(-2) as {
      id: number;
    }[];
    // Emit out of order to prove matching is by id, not arrival order.
    lastWorker?.emit({
      kind: 'transcribeResult',
      // biome-ignore lint/style/noNonNullAssertion: destructured from the two posted messages just asserted above
      id: secondPosted!.id,
      text: 'second',
    });
    lastWorker?.emit({
      kind: 'transcribeResult',
      // biome-ignore lint/style/noNonNullAssertion: destructured from the two posted messages just asserted above
      id: firstPosted!.id,
      text: 'first',
    });
    expect(await first).toBe('first');
    expect(await second).toBe('second');
  });

  it('a request-scoped error rejects only that pending call, not ready()', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    lastWorker?.emit({ kind: 'ready' });
    await engine.ready();
    const resultPromise = engine.transcribe({
      samples: new Float32Array([0.1]),
      sampleRate: 16000,
    });
    const posted = lastWorker?.posted.at(-1) as { id: number };
    lastWorker?.emit({
      kind: 'error',
      id: posted.id,
      message: 'decode failed',
    });
    await expect(resultPromise).rejects.toThrow('decode failed');
  });

  it('a detectSpeech()/transcribe() call issued before ready is not lost — it is still answered (resolved or rejected) once the worker responds', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    // No 'ready' emitted yet — the call must still be posted and tracked,
    // not dropped or forced to wait on readiness itself.
    const detectPromise = engine.detectSpeech(new Float32Array([0.1]));
    const transcribePromise = engine.transcribe({
      samples: new Float32Array([0.2]),
      sampleRate: 16000,
    });
    const posted = lastWorker?.posted as { kind: string; id: number }[];
    const detectPosted = posted.find((m) => m.kind === 'detectSpeech');
    const transcribePosted = posted.find((m) => m.kind === 'transcribe');
    expect(detectPosted).toBeDefined();
    expect(transcribePosted).toBeDefined();
    // Worker rejects the pre-load detectSpeech call (model not loaded yet)
    // but still successfully answers the transcribe call once load finishes.
    lastWorker?.emit({
      kind: 'error',
      // biome-ignore lint/style/noNonNullAssertion: presence just asserted above
      id: detectPosted!.id,
      message: 'VAD model not loaded — call load() first',
    });
    lastWorker?.emit({ kind: 'ready' });
    lastWorker?.emit({
      kind: 'transcribeResult',
      // biome-ignore lint/style/noNonNullAssertion: presence just asserted above
      id: transcribePosted!.id,
      text: 'ok',
    });
    await expect(detectPromise).rejects.toThrow('VAD model not loaded');
    expect(await transcribePromise).toBe('ok');
  });

  it('close() terminates the worker', () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    engine.close();
    expect(lastWorker?.terminated).toBe(true);
  });
});
