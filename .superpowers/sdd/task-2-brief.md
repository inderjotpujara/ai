### Task 2: Voice types

**Files:**
- Create: `src/voice/types.ts`
- Test: `tests/voice/types.test.ts`

**Interfaces:**
- Produces: `VoiceFrames`, `CaptureSource`, `VoiceOutcome`, `VoiceError`, `VoiceConfig`, `Transcriber`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/types.test.ts
import { describe, expect, it } from 'bun:test';
import { CaptureSource, VoiceError, VoiceOutcome } from '../../src/voice/types.ts';

describe('voice types', () => {
  it('VoiceError carries an actionable hint', () => {
    const e = new VoiceError('no audio', 'grant Microphone access');
    expect(e).toBeInstanceOf(Error);
    expect(e.hint).toBe('grant Microphone access');
    expect(e.name).toBe('VoiceError');
  });
  it('enums use explicit string values', () => {
    expect(CaptureSource.Mic).toBe('mic');
    expect(VoiceOutcome.Empty).toBe('empty');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/types.test.ts`
Expected: FAIL — module `src/voice/types.ts` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/voice/types.ts

/** Raw audio ready for the STT engine: mono Float32 in [-1,1] at 16 kHz. */
export type VoiceFrames = {
  samples: Float32Array;
  sampleRate: 16000;
};

export enum CaptureSource {
  Mic = 'mic',
  File = 'file',
}

export enum VoiceOutcome {
  Ok = 'ok',
  Empty = 'empty',
  Failed = 'failed',
  Timeout = 'timeout',
}

/** Typed voice error; `hint` is a user-actionable next step (e.g. mic permission). */
export class VoiceError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}

export type VoiceConfig = {
  /** Absolute path to the moonshine model directory. */
  modelDir: string;
  /** ffmpeg binary (resolved). */
  ffmpeg: string;
  /** Wall-clock cap for a single capture/transcribe op, ms. */
  timeoutMs: number;
};

/** Turns a recorded utterance into text. Impl is in-process or subprocess. */
export type Transcriber = {
  transcribe(frames: VoiceFrames): Promise<string>;
  close(): Promise<void>;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/types.ts tests/voice/types.test.ts
git commit -m "feat(voice): core types (VoiceFrames, VoiceError, Transcriber)"
```

---

