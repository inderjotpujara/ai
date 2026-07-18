### Task 8: `createSttEngine` (main-thread Web Worker host) + mocked-worker tests + canonicalize `ModelTier`

**Files:**
- Create: `web/src/features/voice/stt-engine.ts`
- Test: `web/src/features/voice/stt-engine.test.ts`
- Modify: `web/src/features/settings/index.tsx` (replace the Task 4 temporary local `ModelTier` with an import from `stt-engine.ts` — single source of truth from here on)

**Interfaces:**
- Consumes: `ModelTier` / `SttWorkerRequest` / `SttWorkerResponse` (Task 7, `stt.worker.ts`); `VoiceFrames` (`@contracts`, Task 1).
- Produces (VERBATIM per `phase7-interfaces.md`): `export type LoadProgress = { loaded: number; total: number };`, `export type SttEngine = { ready(): Promise<void>; onProgress(cb): () => void; detectSpeech(chunk16k): Promise<boolean>; transcribe(frames): Promise<string>; close(): void };`, `export function createSttEngine(cfg: { model: ModelTier }): SttEngine;`. Consumed by `use-voice-input.ts` (Part B, Task 10+).

- [ ] **Step 1: Write the failing tests**

Create `web/src/features/voice/stt-engine.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSttEngine } from './stt-engine.ts';
import type { SttWorkerResponse } from './stt.worker.ts';

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
        return fake as unknown as Worker;
      }
    },
  );
});

describe('createSttEngine', () => {
  it('posts a load request for the configured model tier on construction', () => {
    createSttEngine({ model: 'moonshine-tiny' });
    expect(lastWorker?.posted).toEqual([{ kind: 'load', model: 'moonshine-tiny' }]);
  });

  it('ready() resolves only once the worker reports ready, not before', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
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
    const engine = createSttEngine({ model: 'moonshine-base' });
    const onProgress = vi.fn();
    engine.onProgress(onProgress);
    lastWorker?.emit({ kind: 'progress', loaded: 50, total: 100 });
    expect(onProgress).toHaveBeenCalledWith({ loaded: 50, total: 100 });
  });

  it('onProgress unsubscribe stops further callbacks', () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    const onProgress = vi.fn();
    const unsubscribe = engine.onProgress(onProgress);
    unsubscribe();
    lastWorker?.emit({ kind: 'progress', loaded: 1, total: 2 });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('detectSpeech() resolves with the matching response by request id', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    const resultPromise = engine.detectSpeech(new Float32Array([0.1, 0.2]));
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    expect(posted.kind).toBe('detectSpeech');
    lastWorker?.emit({ kind: 'detectSpeechResult', id: posted.id, isSpeech: true });
    expect(await resultPromise).toBe(true);
  });

  it('transcribe() resolves with the matching response by request id', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    const resultPromise = engine.transcribe({
      samples: new Float32Array([0.1]),
      sampleRate: 16000,
    });
    const posted = lastWorker?.posted.at(-1) as { kind: string; id: number };
    expect(posted.kind).toBe('transcribe');
    lastWorker?.emit({ kind: 'transcribeResult', id: posted.id, text: 'hello world' });
    expect(await resultPromise).toBe('hello world');
  });

  it('two concurrent requests resolve independently, matched by their own id', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    const first = engine.transcribe({ samples: new Float32Array([0.1]), sampleRate: 16000 });
    const second = engine.transcribe({ samples: new Float32Array([0.2]), sampleRate: 16000 });
    const [firstPosted, secondPosted] = lastWorker!.posted.slice(-2) as {
      id: number;
    }[];
    // Emit out of order to prove matching is by id, not arrival order.
    lastWorker?.emit({ kind: 'transcribeResult', id: secondPosted.id, text: 'second' });
    lastWorker?.emit({ kind: 'transcribeResult', id: firstPosted.id, text: 'first' });
    expect(await first).toBe('first');
    expect(await second).toBe('second');
  });

  it('a request-scoped error rejects only that pending call, not ready()', async () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    lastWorker?.emit({ kind: 'ready' });
    await engine.ready();
    const resultPromise = engine.transcribe({
      samples: new Float32Array([0.1]),
      sampleRate: 16000,
    });
    const posted = lastWorker?.posted.at(-1) as { id: number };
    lastWorker?.emit({ kind: 'error', id: posted.id, message: 'decode failed' });
    await expect(resultPromise).rejects.toThrow('decode failed');
  });

  it('close() terminates the worker', () => {
    const engine = createSttEngine({ model: 'moonshine-base' });
    engine.close();
    expect(lastWorker?.terminated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/stt-engine.test.ts`
Expected: FAIL — `error: Cannot find module './stt-engine.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/features/voice/stt-engine.ts`:

```ts
import type { VoiceFrames } from '@contracts';
import type { ModelTier, SttWorkerRequest, SttWorkerResponse } from './stt.worker.ts';

export type { ModelTier };
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
 * this, never on construction alone (spec §7.2).
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
      for (const cb of progressListeners) cb({ loaded: msg.loaded, total: msg.total });
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

  worker.postMessage({ kind: 'load', model: cfg.model } satisfies SttWorkerRequest);

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
        { kind: 'detectSpeech', id, chunk: chunk16k } satisfies SttWorkerRequest,
        [chunk16k.buffer],
      );
    });
  }

  function transcribe(frames: VoiceFrames): Promise<string> {
    const id = nextId++;
    return new Promise<string>((resolve, reject) => {
      pendingTranscribe.set(id, { resolve, reject });
      worker.postMessage(
        { kind: 'transcribe', id, samples: frames.samples } satisfies SttWorkerRequest,
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
```

Update `web/src/features/settings/index.tsx` to canonicalize `ModelTier` (remove the Task 4 temporary local definition, import it instead):

```tsx
import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import type { ModelTier } from '../voice/stt-engine.ts';
```

(Delete the `export type ModelTier = 'moonshine-base' | 'moonshine-tiny';` block and its preceding doc comment from Task 4 — everything else in the file is unchanged, since `ModelTier`'s literal values are identical, just now imported rather than locally declared. Re-export it so existing/future importers of `settings/index.tsx`'s `ModelTier` keep working:)

```tsx
export type { ModelTier };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun run test -- features/voice/stt-engine.test.ts features/settings/index.test.tsx`
Expected: PASS (9 `stt-engine` tests + all pre-existing + Task 4's `settings` tests, now sourcing `ModelTier` from `stt-engine.ts`).

Run: `cd web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/stt-engine.ts web/src/features/voice/stt-engine.test.ts web/src/features/settings/index.tsx
git commit -m "feat(voice): createSttEngine — mocked-worker-tested message protocol host (D1/D4/D7)"
```

