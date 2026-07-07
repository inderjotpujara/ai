### Task 11: Voice ingest + chat wiring (capture → transcribe → splice, degrade)

**Files:**
- Create: `src/voice/ingest.ts`
- Create: `src/voice/cli-io.ts` (real `MicIo` + real transcriber wiring)
- Modify: `src/cli/chat.ts` (call `ingestVoice` before/with `ingestMedia`)
- Test: `tests/voice/ingest.test.ts`

**Interfaces:**
- Consumes: `captureFromFile`/`captureFromMic` (Tasks 8–9), `createTranscriber` (Task 7), `resolveVoiceModel`/`ffmpegCmd` (Task 3), `IngestFlags` (Task 10), the run `ledger` + `recordDegrade`.
- Produces: `ingestVoice(rawPrompt, flags, deps): Promise<{ prompt: string; warnings: string[] }>`, where `deps = { captureFile, captureMic, transcriber, ledger? }`. On any voice error: push a warning + `DegradeEvent`, return the original prompt (never throw).

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice/ingest.test.ts
import { describe, expect, it } from 'bun:test';
import { ingestVoice } from '../../src/voice/ingest.ts';
import { VoiceError } from '../../src/voice/types.ts';

const flags = (over = {}) => ({
  images: [], audios: [], videos: [], paste: false, voice: false, voiceIn: [], ...over,
});
const okTranscriber = { transcribe: async () => 'hello there', close: async () => {} };

describe('ingestVoice', () => {
  it('appends the file transcript to the prompt', async () => {
    const { prompt, warnings } = await ingestVoice('context:', flags({ voiceIn: ['a.wav'] }), {
      captureFile: async () => ({ samples: new Float32Array(10), sampleRate: 16000 }),
      captureMic: async () => ({ samples: new Float32Array(0), sampleRate: 16000 }),
      transcriber: okTranscriber,
    });
    expect(prompt).toContain('context:');
    expect(prompt).toContain('hello there');
    expect(warnings).toEqual([]);
  });
  it('degrades to a warning (no throw) when capture fails', async () => {
    const { prompt, warnings } = await ingestVoice('base', flags({ voice: true }), {
      captureFile: async () => ({ samples: new Float32Array(0), sampleRate: 16000 }),
      captureMic: async () => {
        throw new VoiceError('no mic', 'grant Microphone access');
      },
      transcriber: okTranscriber,
    });
    expect(prompt).toBe('base');
    expect(warnings.join(' ')).toMatch(/grant Microphone access/);
  });
  it('returns the prompt unchanged when no voice flag is set', async () => {
    const { prompt } = await ingestVoice('base', flags(), {
      captureFile: async () => ({ samples: new Float32Array(0), sampleRate: 16000 }),
      captureMic: async () => ({ samples: new Float32Array(0), sampleRate: 16000 }),
      transcriber: okTranscriber,
    });
    expect(prompt).toBe('base');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/voice/ingest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/voice/ingest.ts
import { recordDegrade } from '../telemetry/spans.ts';
import { DegradeKind, type DegradationLedger } from '../reliability/ledger.ts';
import type { IngestFlags } from '../media/ingest.ts';
import type { Transcriber, VoiceFrames } from './types.ts';
import { VoiceError } from './types.ts';

export type VoiceIngestDeps = {
  captureFile: (path: string) => Promise<VoiceFrames>;
  captureMic: () => Promise<VoiceFrames>;
  transcriber: Transcriber;
  ledger?: DegradationLedger;
};

export type VoiceIngestResult = { prompt: string; warnings: string[] };

/** Captures + transcribes voice input and splices the transcript into the prompt.
 *  Never throws: any failure becomes a warning + a degrade-ledger entry. */
export async function ingestVoice(
  rawPrompt: string,
  flags: IngestFlags,
  deps: VoiceIngestDeps,
): Promise<VoiceIngestResult> {
  const warnings: string[] = [];
  const transcripts: string[] = [];

  const collect = async (get: () => Promise<VoiceFrames>) => {
    try {
      const frames = await get();
      const text = (await deps.transcriber.transcribe(frames)).trim();
      if (text) transcripts.push(text);
    } catch (err) {
      const hint = err instanceof VoiceError && err.hint ? ` — ${err.hint}` : '';
      warnings.push(`voice: ${(err as Error).message}${hint}`);
      deps.ledger?.record?.({ kind: DegradeKind.ToolSkipped, detail: 'voice input failed' });
    }
  };

  for (const path of flags.voiceIn) await collect(() => deps.captureFile(path));
  if (flags.voice) await collect(() => deps.captureMic());

  const prompt = [rawPrompt, ...transcripts].filter(Boolean).join('\n\n').trim();
  return { prompt, warnings };
}
```

Then create `src/voice/cli-io.ts` (real deps: `resolveVoiceModel`/`ffmpegCmd` → `VoiceConfig`; `createTranscriber(cfg)`; `captureFromFile`-bound; a real `MicIo` using ffmpeg avfoundation + raw-TTY). Wire into `src/cli/chat.ts` `main`: after building the media `store`, call `ingestVoice(rawPrompt, flags, realDeps)` to get an updated prompt, feed its result as the `rawPrompt` into `ingestMedia`, and print its warnings via the existing `console.error('media: ...')`-style loop. Confirm `recordDegrade`/`DegradeKind`/`ledger.record` names against `src/reliability/ledger.ts` at implementation time.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/voice/ingest.test.ts`
Expected: PASS (3 tests). Then `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/voice/ingest.ts src/voice/cli-io.ts src/cli/chat.ts tests/voice/ingest.test.ts
git commit -m "feat(voice): ingestVoice + chat wiring (splice, degrade-never-crash)"
```

---

