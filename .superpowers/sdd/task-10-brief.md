### Task 10: `stt-engine.ts` — forward `transcribeInterim` via a per-call, id-correlated `onInterim` callback

**Files:**
- Modify: `web/src/features/voice/stt-engine.ts` (`SttEngine` type lines 8–14; `worker.onmessage` lines 56–89; `transcribe()` lines 124–138; `close()` lines 140–154)
- Test: `web/src/features/voice/stt-engine.test.ts` (append)

**Interfaces:**
- Consumes: `SttWorkerResponse`'s new `{ kind: 'transcribeInterim'; id: number; text: string }` variant (Task 9).
- Produces: `SttEngine.transcribe(frames: VoiceFrames, onInterim?: (text: string) => void): Promise<string>` (widened from `transcribe(frames: VoiceFrames): Promise<string>`). Correlation is by the same numeric request `id` `transcribe()` already generates for `pendingTranscribe` — a new `interimListeners: Map<number, (text: string) => void>` is populated only for the duration of that one request and deleted the moment it settles (`transcribeResult` or `error` for that id, or `close()`), so two concurrent `transcribe()` calls never cross-deliver interim text to each other's callback.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/voice/stt-engine.test.ts` (inside the existing `describe('createSttEngine', ...)` block, after the "transcribe() resolves with the matching response by request id" test):

```ts
  it('transcribe() forwards transcribeInterim messages to an optional onInterim callback, id-correlated', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const onInterim = vi.fn();
    const resultPromise = engine.transcribe(
      { samples: new Float32Array([0.1]), sampleRate: 16000 },
      onInterim,
    );
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    lastWorker?.emit({ kind: 'transcribeInterim', id: posted.id, text: 'Hel' });
    lastWorker?.emit({ kind: 'transcribeInterim', id: posted.id, text: 'Hello' });
    lastWorker?.emit({
      kind: 'transcribeResult',
      id: posted.id,
      text: 'Hello world',
    });
    expect(await resultPromise).toBe('Hello world');
    expect(onInterim.mock.calls).toEqual([['Hel'], ['Hello']]);
  });

  it('does not cross-deliver transcribeInterim between two concurrent transcribe() calls (different ids)', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const onInterimA = vi.fn();
    const onInterimB = vi.fn();
    const promiseA = engine.transcribe(
      { samples: new Float32Array([0.1]), sampleRate: 16000 },
      onInterimA,
    );
    const postedA = lastWorker?.posted.at(-1) as { kind: string; id: number };
    const promiseB = engine.transcribe(
      { samples: new Float32Array([0.2]), sampleRate: 16000 },
      onInterimB,
    );
    const postedB = lastWorker?.posted.at(-1) as { kind: string; id: number };

    lastWorker?.emit({ kind: 'transcribeInterim', id: postedA.id, text: 'A-text' });
    lastWorker?.emit({ kind: 'transcribeInterim', id: postedB.id, text: 'B-text' });
    expect(onInterimA).toHaveBeenCalledWith('A-text');
    expect(onInterimA).not.toHaveBeenCalledWith('B-text');
    expect(onInterimB).toHaveBeenCalledWith('B-text');
    expect(onInterimB).not.toHaveBeenCalledWith('A-text');

    lastWorker?.emit({ kind: 'transcribeResult', id: postedA.id, text: 'A final' });
    lastWorker?.emit({ kind: 'transcribeResult', id: postedB.id, text: 'B final' });
    expect(await promiseA).toBe('A final');
    expect(await promiseB).toBe('B final');
  });

  it('stops delivering to onInterim once its request has settled (no leaked listener)', async () => {
    const engine = createSttEngine({ model: ModelTier.Base });
    const onInterim = vi.fn();
    const resultPromise = engine.transcribe(
      { samples: new Float32Array([0.1]), sampleRate: 16000 },
      onInterim,
    );
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    lastWorker?.emit({ kind: 'transcribeResult', id: posted.id, text: 'done' });
    await resultPromise;

    // A stray late transcribeInterim for the same, already-settled id must
    // not throw and must not resurrect the callback via a stale map entry.
    expect(() =>
      lastWorker?.emit({ kind: 'transcribeInterim', id: posted.id, text: 'late' }),
    ).not.toThrow();
    expect(onInterim).not.toHaveBeenCalledWith('late');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/stt-engine.test.ts`
Expected: FAIL — `engine.transcribe(frames, onInterim)`'s second argument is silently ignored by the current implementation (`onInterim` mock never called); `transcribeInterim` messages are unhandled by `worker.onmessage`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/features/voice/stt-engine.ts`, widen the `SttEngine` type (lines 8–14):

```ts
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
```

Add a new correlation map next to `pendingTranscribe` (near line 54):

```ts
  const pendingTranscribe = new Map<number, Pending<string>>();
  // D6: id-correlated interim-text forwarding — one entry per in-flight
  // transcribe() call that supplied an onInterim callback, deleted the
  // moment that id settles (transcribeResult/error) or on close(). NOT a
  // Set-based multi-subscriber (unlike progressListeners): interim text is
  // inherently per-request, and two concurrent transcribe() calls (e.g. a
  // back-to-back gesture, spec §7.1 (d)) must never cross-deliver.
  const interimListeners = new Map<number, (text: string) => void>();
```

In `worker.onmessage` (lines 56–89), add a branch for `transcribeInterim` (placed after `detectSpeechResult`, before `transcribeResult`) and clear the listener wherever `pendingTranscribe.delete(msg.id)` already happens:

```ts
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
```

Update `transcribe()` (lines 124–138):

```ts
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
```

Update `close()` (lines 140–154) to also clear the new map:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/stt-engine.test.ts`
Expected: PASS (all pre-existing tests + 3 new).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/stt-engine.ts web/src/features/voice/stt-engine.test.ts
git commit -m "feat(voice): stt-engine.ts forwards id-correlated transcribeInterim via onInterim (D6)"
```

---

