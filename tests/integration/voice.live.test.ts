/**
 * Live-verify (Task 13): exercises the REAL sherpa-onnx-node addon, the
 * REAL downloaded moonshine-tiny model, and REAL ffmpeg — no mocks. Gated
 * behind VOICE_LIVE=1 (needs `bun run setup:voice` to have downloaded the
 * model first). Uses macOS `say` to generate deterministic synthetic
 * speech so the file-capture path is fully automatable without a human/mic.
 *
 * Run:
 *   VOICE_LIVE=1 bun test tests/integration/voice.live.test.ts
 *   AGENT_VOICE_EXEC=subprocess VOICE_LIVE=1 bun test tests/integration/voice.live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from '../../src/reliability/ledger.ts';
import { captureFromFile } from '../../src/voice/capture.ts';
import { resolveVoiceConfig } from '../../src/voice/cli-io.ts';
import { ingestVoice } from '../../src/voice/ingest.ts';
import { createTranscriber } from '../../src/voice/transcribe.ts';
import type { VoiceConfig } from '../../src/voice/types.ts';

const live = process.env.VOICE_LIVE === '1';

const WORDS_PATH = join(tmpdir(), `voice-live-words-${process.pid}.aiff`);
const SILENT_PATH = join(tmpdir(), `voice-live-silent-${process.pid}.wav`);

/** Runs `cmd` and resolves its exit code (never throws). */
async function run(cmd: string[]): Promise<number> {
  const p = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
  return await p.exited;
}

describe.if(live)('voice live-verify (real moonshine + ffmpeg)', () => {
  beforeAll(async () => {
    const sayCode = await run([
      'say',
      '-o',
      WORDS_PATH,
      'the quick brown fox jumps',
    ]);
    if (sayCode !== 0) throw new Error('say failed to generate speech clip');
    // ~0.2s of digital silence — a tiny/near-empty capture for the edge case.
    const silenceCode = await run([
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=16000:cl=mono',
      '-t',
      '0.2',
      SILENT_PATH,
    ]);
    if (silenceCode !== 0)
      throw new Error('ffmpeg failed to generate silent clip');
  }, 30_000);

  afterAll(() => {
    for (const p of [WORDS_PATH, SILENT_PATH]) {
      try {
        rmSync(p, { force: true });
      } catch {}
    }
  });

  it('transcribes a real speech clip to matching text', async () => {
    const cfg = resolveVoiceConfig(process.env);
    const frames = await captureFromFile(WORDS_PATH, cfg);
    const transcriber = createTranscriber(cfg, process.env);
    try {
      const text = await transcriber.transcribe(frames);
      console.log(
        `[voice.live] transcript (${process.env.AGENT_VOICE_EXEC ?? 'in-process'}): ${JSON.stringify(text)}`,
      );
      expect(text.length).toBeGreaterThan(0);
      expect(text).toMatch(/fox|quick|brown/i);
    } finally {
      await transcriber.close();
    }
  }, 60_000);

  it('degrades gracefully on a silent/near-empty clip (no crash)', async () => {
    const cfg = resolveVoiceConfig(process.env);
    const ledger = createLedger();
    const result = await ingestVoice(
      'original prompt',
      {
        voice: false,
        voiceIn: [SILENT_PATH],
        images: [],
        audios: [],
        videos: [],
        paste: false,
      },
      {
        captureFile: (p) => captureFromFile(p, cfg),
        captureMic: async () => {
          throw new Error('mic not used in this test');
        },
        transcriber: createTranscriber(cfg, process.env),
        ledger,
      },
    );
    // Silence -> empty transcript is a successful-but-empty transcription,
    // not a thrown error, so ingestVoice's collect() intentionally does not
    // record a warning for it (only actual capture/transcribe failures do).
    // The contract under test is "never crashes" — verified here.
    expect(result.prompt).toBe('original prompt');
  }, 60_000);

  it('degrades (throws catchable, not a native crash) when the model dir does not exist', async () => {
    const cfg: VoiceConfig = {
      ...resolveVoiceConfig(process.env),
      modelDir: '/tmp/nonexistent-voice-model-dir',
    };
    let threw: unknown;
    if (process.env.AGENT_VOICE_EXEC === 'subprocess') {
      // The subprocess transcriber defers loading the addon/model to the
      // worker, only when `.transcribe()` is called — so the bad path
      // surfaces there (as `stt worker failed: ...`), not at construction.
      const frames = await captureFromFile(WORDS_PATH, {
        ...resolveVoiceConfig(process.env),
      });
      const transcriber = createTranscriber(cfg, process.env);
      try {
        await transcriber.transcribe(frames);
      } catch (err) {
        threw = err;
      } finally {
        await transcriber.close();
      }
    } else {
      // Mirrors chat.ts's own try/catch around createCliVoiceDeps/
      // createTranscriber: in-process construction happens eagerly and
      // must throw a catchable JS error (never segfault the process) when
      // the model files are missing.
      try {
        createTranscriber(cfg, process.env);
      } catch (err) {
        threw = err;
      }
    }
    expect(threw).toBeDefined();
  }, 30_000);

  it('honors an unreasonably tight timeout budget (subprocess) or documents why in-process cannot (native decode blocks the JS thread)', async () => {
    const base = resolveVoiceConfig(process.env);
    const cfg: VoiceConfig = { ...base, timeoutMs: 1 };
    const frames = await captureFromFile(WORDS_PATH, cfg);
    const transcriber = createTranscriber(cfg, process.env);
    try {
      let threw: unknown;
      try {
        await transcriber.transcribe(frames);
      } catch (err) {
        threw = err;
      }
      if (process.env.AGENT_VOICE_EXEC === 'subprocess') {
        // The worker runs out-of-process, so the parent's event loop stays
        // free to service the timer and `kill()` the child — verified live:
        // a 1ms budget reliably rejects with Error('timeout').
        expect(threw).toBeDefined();
        expect((threw as Error).message).toBe('timeout');
      } else {
        // KNOWN LIMITATION (live-verified, not fixed here — see Task 13
        // report): `recognizer.decode()` is a synchronous, CPU-blocking
        // native call with no internal yield point. `withWallClock`'s
        // `Promise.race` can only lose to a timer that gets a chance to
        // fire, and a blocked JS thread never services timers mid-call —
        // so an in-process transcription ALWAYS runs to completion
        // regardless of `timeoutMs`. Document the real behavior instead of
        // asserting an impossible one; `AGENT_VOICE_EXEC=subprocess` is the
        // path that actually enforces the wall clock.
        expect(threw).toBeUndefined();
      }
    } finally {
      await transcriber.close();
    }
  }, 30_000);
});
