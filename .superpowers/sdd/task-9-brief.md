### Task 9: `stt.worker.ts` — `transcribeInterim` response variant + `TextStreamer` callback in `transcribe()`

**Files:**
- Modify: `web/src/features/voice/stt.worker.ts` (`SttWorkerResponse` union lines 35–40; `transcribe()` lines 162–175; `self.onmessage`'s `transcribe` branch lines 202–211; header comment lines 1–13)
- Test: `web/src/features/voice/stt.worker.test.ts` (append)

**Interfaces:**
- Consumes: `TextStreamer` from `@huggingface/transformers` (verified export — `transformers.js:45` does `export * from './generation/streamers.js'`; constructor `new TextStreamer(tokenizer: PreTrainedTokenizer, { skip_prompt?: boolean; skip_special_tokens?: boolean; callback_function?: (text: string) => void })` — `callback_function` receives only the newly-finalized **delta** substring per call, per `streamers.js`'s `on_finalized_text`, NOT the full accumulated text); `asrProcessor.tokenizer` (a `Processor` getter, typed `PreTrainedTokenizer | undefined`); `asrModel.generate({ ...inputs, max_new_tokens: 256, streamer })` (verified `streamer` is a real generate-option — `modeling_utils.js:842` destructures `streamer = null` and calls `streamer.put(...)`/`streamer.end()` during generation, lines 944–945/1013–1014/1030–1031).
- Produces: new `SttWorkerResponse` variant `{ kind: 'transcribeInterim'; id: number; text: string }` — `text` is always the **full accumulated** interim string so far (not a delta), so every consumer downstream can treat each message as a monotonic **replace** (spec §7.1 (b)) instead of an append. Also produces an exported pure helper `createInterimAccumulator(): { push(chunk: string): string }`, isolated and unit-tested the same way `detectWebGpuDevice` already is in this file (real model/generate behavior stays live-verify-only, per the file's own header comment).

- [ ] **Step 1: Write the failing test**

Append to `web/src/features/voice/stt.worker.test.ts`:

```ts
import { createInterimAccumulator, detectWebGpuDevice } from './stt.worker.ts';
```

(replace the existing single-symbol import line with the two-symbol one above), then append a new `describe` block at the bottom of the file:

```ts
// The pure accumulation logic behind the new `transcribeInterim` response
// variant (D6) — isolated exactly like `detectWebGpuDevice` above, because
// `TextStreamer`'s `callback_function` only ever hands back the newly
// finalized DELTA substring per call (see `streamers.js`'s
// `on_finalized_text`); everything downstream of a real streamer wired to a
// real `generate()` call is live-verify-only, same as the rest of this file.
describe('createInterimAccumulator', () => {
  it('accumulates incremental TextStreamer chunks into the full running text (never a delta)', () => {
    const acc = createInterimAccumulator();
    expect(acc.push('Hello ')).toBe('Hello ');
    expect(acc.push('world')).toBe('Hello world');
    expect(acc.push('!')).toBe('Hello world!');
  });

  it('starts empty and handles an immediate empty-string chunk without changing the running text', () => {
    const acc = createInterimAccumulator();
    expect(acc.push('')).toBe('');
    expect(acc.push('ok')).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun run test -- features/voice/stt.worker.test.ts`
Expected: FAIL — `createInterimAccumulator` is not exported from `./stt.worker.ts`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/features/voice/stt.worker.ts`, update the import line (add `TextStreamer`):

```ts
import {
  AutoModel,
  AutoProcessor,
  env,
  type PreTrainedModel,
  type PretrainedConfig,
  type Processor,
  type ProgressInfo,
  Tensor,
  TextStreamer,
} from '@huggingface/transformers';
```

Add the new response variant to `SttWorkerResponse` (lines 35–40):

```ts
export type SttWorkerResponse =
  | { kind: 'progress'; loaded: number; total: number }
  | { kind: 'ready' }
  | { kind: 'detectSpeechResult'; id: number; isSpeech: boolean }
  | { kind: 'transcribeInterim'; id: number; text: string }
  | { kind: 'transcribeResult'; id: number; text: string }
  | { kind: 'error'; id?: number; message: string };
```

Add the pure accumulator (place just above `transcribe()`, near the other small pure helpers):

```ts
/** Pure accumulation for `TextStreamer`'s incremental `callback_function`
 * calls — each call hands back only the newly finalized DELTA substring
 * since the last call (see `@huggingface/transformers`'s
 * `TextStreamer.on_finalized_text`). Returning the FULL running text on
 * every `push()` is what lets `use-voice-input.ts` treat every
 * `transcribeInterim` message as a monotonic REPLACE of its displayed
 * interim text (spec §7.1 (b)), never an append. Isolated and unit-tested
 * the same way `detectWebGpuDevice` above is — everything downstream (a real
 * streamer wired to a real `generate()` call) is live-verify-only. */
export function createInterimAccumulator(): { push(chunk: string): string } {
  let text = '';
  return {
    push(chunk: string): string {
      text += chunk;
      return text;
    },
  };
}
```

Replace `transcribe()` (lines 162–175):

```ts
async function transcribe(samples: Float32Array, id: number): Promise<string> {
  const tokenizer = asrProcessor?.tokenizer;
  if (!asrModel || !asrProcessor || !tokenizer) {
    throw new Error('ASR model not loaded — call load() first');
  }
  const inputs = await asrProcessor(samples);
  const accumulator = createInterimAccumulator();
  // D6: emits `transcribeInterim` as Moonshine decodes the already-captured
  // buffer — progressive reveal AFTER capture, never real-time-during-speech
  // (spec D6/§9). `skip_prompt` drops the encoder-decoder's initial
  // decoder-start token from the stream (it is not user-meaningful text).
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      post({ kind: 'transcribeInterim', id, text: accumulator.push(chunk) });
    },
  });
  const output = (await asrModel.generate({
    ...inputs,
    max_new_tokens: 256,
    streamer,
  })) as Tensor;
  const [text] = asrProcessor.batch_decode(output, {
    skip_special_tokens: true,
  });
  return text ?? '';
}
```

Update the `transcribe` branch of `self.onmessage` (lines 202–211) to pass `msg.id` through:

```ts
  if (msg.kind === 'transcribe') {
    transcribe(msg.samples, msg.id)
      .then((text) => post({ kind: 'transcribeResult', id: msg.id, text }))
      .catch((err: unknown) => {
        post({
          kind: 'error',
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }
```

Update the file's header comment (lines 1–13) — append one clause to the existing sentence about what's unit-tested:

```
 * ... The one piece of pure logic worth isolating — WebGPU device detection,
 * and (Phase 8, D6) the TextStreamer callback-accumulation logic — IS
 * exported and unit tested here (see stt.worker.test.ts); everything past
 * that boundary (actual model load/inference, including the real streamer
 * wired to a real generate() call) is validated at live-verify, not by an
 * automated test.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun run test -- features/voice/stt.worker.test.ts`
Expected: PASS (6 tests: 4 pre-existing `detectWebGpuDevice` + 2 new `createInterimAccumulator`).

Run: `cd web && bun run typecheck`
Expected: PASS (confirms `tokenizer` narrowing via the local `const tokenizer = asrProcessor?.tokenizer;` guard, and the `streamer` option compiles against `generate()`'s real signature).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/stt.worker.ts web/src/features/voice/stt.worker.test.ts
git commit -m "feat(voice): stream transcribeInterim via a TextStreamer callback in stt.worker.ts (D6)"
```

---

