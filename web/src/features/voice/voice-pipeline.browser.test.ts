// Automated REAL-browser end-to-end test for the Slice 30b Phase 7 voice
// pipeline (Vitest browser-mode + Chromium, config: vitest.browser.config.ts).
//
// WHY this exists: the happy-dom unit suite structurally cannot catch the
// real-browser integration bugs — it has no AudioWorklet, no WASM/WebGPU, and
// a fully mocked Worker/getUserMedia. Three such bugs already slipped to
// manual live-verify (silero-vad load API, AudioWorklet build-emit, real model
// wiring). This test closes the gap: Chromium is launched with fake-audio
// flags (see vitest.browser.config.ts) so getUserMedia returns a known 16 kHz
// speech clip, then it mounts the REAL MicButton (→ useVoiceInput →
// createAudioCapture with the real worklet → real stt-engine Worker → real
// Moonshine + Silero VAD) and asserts the transcription of that clip.
//
// It is gated OUT of the default fast suite: the filename `*.browser.test.ts`
// is excluded in vitest.config.ts and only included by vitest.browser.config
// (run via `bun run test:voice-e2e`). It downloads real models — allow minutes.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test } from 'vitest';
import { MicButton } from './mic-button.tsx';
import { ModelTier } from './model-tier.ts';

const VOICE_ENABLED_KEY = 'agent.voiceInputEnabled';
const VOICE_MODEL_TIER_KEY = 'agent.voiceModelTier';

// Words present in web/src/features/voice/__fixtures__/speech-16k.wav
// ("the quick brown fox jumps over the lazy dog"). ASR is imperfect, so we
// accept a match on ANY of the salient content words (case-insensitive).
const EXPECTED_WORDS = /quick|brown|fox|jump|lazy|dog/i;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test('real Chromium: hold-to-talk transcribes the fake-mic speech clip', async () => {
  // MicButton reads these at render (settings/index.tsx). Base is the shipped
  // default tier (and what manual live-verify validated), so the e2e exercises
  // exactly the production configuration.
  localStorage.setItem(VOICE_ENABLED_KEY, 'true');
  localStorage.setItem(VOICE_MODEL_TIER_KEY, ModelTier.Base);

  let finalText = '';
  const transcripts: string[] = [];
  render(
    createElement(MicButton, {
      onFinal: (text: string) => {
        finalText = text;
        transcripts.push(text);
      },
    }),
  );

  const holdButton = await screen.findByTestId('mic-hold-button');

  // Phase 1 — engine reaches ready: the real Worker downloads + loads Moonshine
  // and Silero VAD, then `useVoiceInput` flips status to 'ready', which enables
  // the hold button (disabled while status === 'loading'). Long timeout: this
  // is the model download.
  await waitFor(
    () => {
      expect(holdButton).not.toBeDisabled();
    },
    { timeout: 200_000, interval: 500 },
  );

  // Phase 2 — hold-to-talk: pointerdown opens the real mic (getUserMedia →
  // Chromium fake-audio WAV) and the AudioWorklet starts downsampling to 16 kHz
  // chunks. Hold long enough for the ~2.5s clip to play through the graph.
  fireEvent.pointerDown(holdButton);
  await waitFor(
    () => {
      expect(holdButton.textContent).toContain('Listening');
    },
    { timeout: 20_000, interval: 200 },
  );
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  // Phase 3 — release flushes the segment → real transcribe → onFinal.
  fireEvent.pointerUp(holdButton);
  await waitFor(
    () => {
      expect(finalText.trim().length).toBeGreaterThan(0);
    },
    { timeout: 60_000, interval: 250 },
  );

  // console.warn (not .log) so vitest browser-mode forwards it to the terminal
  // — records the actual transcript observed for this run.
  console.warn(`[voice-e2e] observed transcript: ${JSON.stringify(finalText)}`);
  expect(finalText).toMatch(EXPECTED_WORDS);
});
