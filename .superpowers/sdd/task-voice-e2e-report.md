# Task: Automated real-browser E2E for the Slice 30b Phase 7 voice pipeline

**Status: COMPLETE — e2e GREEN.** Branch `slice-30b-phase7-voice`.

## What was built

A Vitest browser-mode (Chromium via Playwright) end-to-end test that drives the
REAL voice pipeline — no mocks — fed by a fake microphone, fully automated.

### Files
- `web/vitest.browser.config.ts` (new) — browser-mode config, isolated from the
  fast suite. Carries the prod vite bits the pipeline needs (worker `format:'es'`,
  `optimizeDeps.exclude:['@huggingface/transformers']`, COOP/COEP isolation
  headers, `@contracts` alias).
- `web/src/features/voice/voice-pipeline.browser.test.ts` (new) — mounts the REAL
  `MicButton` (→ `useVoiceInput` → `createAudioCapture` w/ real AudioWorklet →
  real `stt-engine` Worker → real Moonshine + Silero VAD), waits for engine ready
  (200s timeout, real model download), drives hold-to-talk
  (pointerDown → 5s → pointerUp), asserts the transcript matches the fixture words.
- `web/src/test/browser-setup.ts` (new) — jest-dom matchers ONLY; deliberately
  installs NO fakes (unlike happy-dom `setup.ts`) so the real Web Audio /
  getUserMedia stack runs.
- `web/scripts/check-worklet-build.ts` (new) — build-artifact guard: after
  `vite build`, asserts a dist JS chunk containing `registerProcessor` exists
  (guards the Rolldown worklet-emit regression a dev-server test can't).
- `web/src/features/voice/__fixtures__/speech-16k.wav` (new) — generated via
  `say ... "the quick brown fox jumps over the lazy dog"` → `ffmpeg -ar 16000
  -ac 1 -c:a pcm_s16le`; 16 kHz mono, 2.5s.
- `web/vitest.config.ts` — excludes `**/*.browser.test.ts` from the fast suite.
- `web/package.json` — devDeps `@vitest/browser@^4`, `@vitest/browser-playwright@^4`,
  `playwright@^1.61.1`; script `test:voice-e2e` = `vite build && bun run
  scripts/check-worklet-build.ts && vitest run --config vitest.browser.config.ts`.
- `.gitignore` — ignores `web/.vitest-attachments/` + `web/src/**/__screenshots__/`.
- **`web/src/features/voice/stt.worker.ts` — PRODUCT BUG FIX (see below).**

## Validated @vitest/browser v4 config shape (context7 `/vitest-dev/vitest`)

v4 changed the provider API (v3→v4 breaking). The provider is now a factory
imported from a SEPARATE package:

```ts
import { playwright } from '@vitest/browser-playwright';
// ...
test: {
  browser: {
    enabled: true,
    headless: true,
    provider: playwright({ launchOptions: { args: [ ...chromium flags ] } }),
    instances: [{ browser: 'chromium' }],
  },
}
```

`launchOptions` is passed straight to Playwright's `browser.launch`, so Chromium
flags go in `launchOptions.args`. (Old v3 `provider:'playwright'` string +
per-instance `launch:{}` is removed.)

## Fake-audio launch args (the key enabler)

```
--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream        (auto-grants mic permission, no prompt)
--use-file-for-fake-audio-capture=<abs path to speech-16k.wav>
```

getUserMedia then returns the WAV as the mic → real hold-to-talk → real
downsample worklet → real Moonshine transcription, zero human interaction.

## PRODUCT BUG the harness caught + fixed

**Bug:** `stt.worker.ts` called `AutoModel.from_pretrained(id, { device })` with
NO `dtype`. On the WASM/CPU path (any machine WITHOUT WebGPU — the "(CPU mode)"
the UI advertises), ONNX session creation crashes:
`qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale:
model.decoder.embed_tokens.weight_merged_0_scale`. The default q4 (and q8)
Moonshine decoder ONNX ships WITHOUT the scale tensor its MatMulNBits nodes need.
Verified empirically: default / `'fp32'` / `'q8'` / `'q4'` / `'fp16'` (string
form) ALL fail; only the per-subgraph object `{ encoder_model:'fp32',
decoder_model_merged:'fp32' }` creates a working session AND transcribes.

Live-verify (T17) passed only because it ran on the M4 Pro **with WebGPU**, whose
default path differs — the CPU fallback was silently broken for all
non-WebGPU users.

**Fix (minimal, zero-WebGPU-regression):** per-device dtype —
```ts
const dtype = device === 'wasm'
  ? ({ encoder_model: 'fp32', decoder_model_merged: 'fp32' } as const)
  : undefined;   // webgpu keeps the validated default, byte-for-byte unchanged
```
The `device==='webgpu'` branch is untouched, so the user's real machine behaves
exactly as before; only the previously-broken CPU path changes. **Controller:
please review this product change** (and any doc/download-size note — CPU mode now
loads fp32).

## WebGPU-in-headless finding (why WASM is the path under test)

Probed exhaustively: Playwright's Chromium (bundled AND system `channel:'chrome'`,
headless AND headed, with `--enable-unsafe-webgpu` / `--enable-features` /
`ignoreDefaultArgs:['--disable-gpu']`) exposes **NO** `navigator.gpu` — main
thread or worker — in every configuration. So the e2e necessarily exercises the
WASM/CPU path. That is legitimate (a first-class shipped path) and is exactly
what surfaced the bug above.

## Verification

- `test:voice-e2e`: **PASS** (exit 0). Build guard: "registerProcessor found in
  downsample-worklet-_q4B9x1q.js". Test: 1 passed (~24s warm, ~200s cold w/
  model download).
- **Observed transcript** (real in-browser MicButton pipeline): `"The quick
  brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy
  dog."` (repeats because the fake-audio file loops during the 5s hold).
- Default fast suite: `cd web && bun run test` → **284 passed (unchanged)**.
- `bun run typecheck`: clean. `bun run lint` on all new/changed files: clean.

## Notes / concerns

- Benign `act(...)` console warnings during the run — real async worker→setState
  updates fire outside `fireEvent`; inherent to testing real async React, not a
  failure. Left as-is.
- The e2e is gated OUT of `bun run test` / `bun run check` (models ~130MB, slow);
  run explicitly via `bun run test:voice-e2e`.
