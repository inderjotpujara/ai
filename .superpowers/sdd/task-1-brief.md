### Task 1: Lift `VoiceFrames` into `src/contracts/voice.ts` (plain type, non-zod)

**Files:**
- Create: `src/contracts/voice.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/voice/types.ts:1-5`
- Test: `tests/contracts/voice.test.ts`

**Interfaces:**
- Consumes: nothing (this is the first task; `Float32Array` is a built-in).
- Produces: `VoiceFrames` type (`{ samples: Float32Array; sampleRate: 16000 }`), importable from `src/contracts/voice.ts`, `src/contracts/index.ts` (via `@contracts` in `web/`), and re-exported (not redefined) from `src/voice/types.ts` for every existing CLI import site (`src/voice/capture.ts`, `src/voice/transcribe.ts`, `src/telemetry/spans.ts`, and their tests).

- [ ] **Step 1: Write the failing test**

Create `tests/contracts/voice.test.ts`:

```ts
import { expect, test } from 'bun:test';
import type { VoiceFrames } from '../../src/contracts/voice.ts';

test('VoiceFrames is a plain {samples,sampleRate:16000} shape (contracts, no zod — D5 exception)', () => {
  const frames: VoiceFrames = {
    samples: new Float32Array([0.1, -0.2, 0.3]),
    sampleRate: 16000,
  };
  expect(frames.sampleRate).toBe(16000);
  expect(frames.samples).toBeInstanceOf(Float32Array);
  expect(frames.samples.length).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/contracts/voice.test.ts`
Expected: FAIL — `error: Cannot find module '../../src/contracts/voice.ts'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/contracts/voice.ts`:

```ts
/**
 * Raw audio ready for the STT engine: mono Float32 in [-1,1] at 16 kHz.
 * Lifted from `src/voice/types.ts` (Slice 30b Phase 7, D5) so the browser
 * voice code (`web/src/features/voice/`) and the CLI (`src/voice/`) share
 * ONE definition — `src/voice/types.ts` re-exports this rather than
 * redefining it.
 *
 * Deliberate exception to the "every contract is a zod schema" convention
 * every other file in this directory follows: `VoiceFrames` never crosses
 * an HTTP wire in this phase (audio never leaves the browser tab — there is
 * no server-side voice route), so there is no round-trip to validate and a
 * zod schema for a `Float32Array` field would add ceremony with nothing to
 * protect.
 */
export type VoiceFrames = {
  samples: Float32Array;
  sampleRate: 16000;
};
```

Modify `src/contracts/index.ts` (add the new re-export, alphabetically before `./enums.ts` would read oddly — keep the existing four lines and simply append):

```ts
export * from './dto.ts';
export * from './enums.ts';
export * from './events.ts';
export * from './requests.ts';
export * from './voice.ts';
```

Modify `src/voice/types.ts` — replace the local `VoiceFrames` definition (lines 1-5) with a re-export:

```ts
/** Re-exported from contracts (Slice 30b Phase 7, D5) — the browser voice
 *  code needs the IDENTICAL shape and `src/voice/` is Node-only, so
 *  `src/contracts/voice.ts` is now the single source of truth; this file
 *  re-exports rather than redefines. */
export type { VoiceFrames } from '../contracts/voice.ts';
```

(Leave the rest of `src/voice/types.ts` — `CaptureSource`, `VoiceOutcome`, `VoiceError`, `VoiceConfig`, `Transcriber` — untouched for this task; `CaptureSource` moves in Task 2.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/contracts/voice.test.ts`
Expected: PASS (1 test).

Then confirm the CLI voice code still compiles against the re-export:

Run: `bun run typecheck`
Expected: PASS, no errors in `src/voice/**`, `src/telemetry/spans.ts`, or their tests.

Also run the full existing voice test suite to confirm nothing broke:

Run: `bun test tests/voice/`
Expected: PASS (all pre-existing voice tests, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/contracts/voice.ts src/contracts/index.ts src/voice/types.ts tests/contracts/voice.test.ts
git commit -m "feat(voice): lift VoiceFrames into src/contracts as a plain non-zod type (D5)"
```

