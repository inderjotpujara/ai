import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Absolute path to the 16 kHz mono speech WAV fed to Chromium's fake mic via
// `--use-file-for-fake-audio-capture`. getUserMedia then returns this clip as
// the microphone stream, so the WHOLE real pipeline (worklet downsample → VAD
// → Moonshine transcribe) runs against known speech with zero human in the
// loop. See voice-pipeline.browser.test.ts.
const SPEECH_WAV = resolve(
  import.meta.dirname,
  'src/features/voice/__fixtures__/speech-16k.wav',
);

// Same COOP/COEP isolation the prod server ships (see vite.config.ts): makes
// the page cross-origin-isolated so transformers.js can use threaded WASM
// (SharedArrayBuffer). This is the real headers path the pipeline depends on,
// so the e2e must exercise it rather than a relaxed test-only variant.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@contracts': resolve(import.meta.dirname, '../src/contracts/index.ts'),
    },
  },
  server: { headers: isolation, fs: { allow: ['..'] } },
  // Match prod: the STT worker + downsample worklet must build as ES modules
  // (new Worker(url, { type: 'module' }) + dynamic backend import()).
  worker: { format: 'es' },
  optimizeDeps: {
    // transformers.js ships its own WASM/ONNX binaries — don't pre-bundle.
    exclude: ['@huggingface/transformers'],
  },
  test: {
    globals: true,
    // The real Moonshine + Silero VAD download (~tens of MB) plus real
    // transcription — allow minutes, never the 5s default.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    // NOT ./src/test/setup.ts — that stubs navigator.mediaDevices /
    // AudioContext with happy-dom fakes, which would shadow the REAL
    // getUserMedia + Web Audio we need here. Only jest-dom matchers.
    setupFiles: ['./src/test/browser-setup.ts'],
    include: ['**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          // Chromium fake-media flags: auto-grant mic permission (no prompt)
          // and feed our WAV as the capture device, so getUserMedia yields
          // real intelligible speech with no interaction.
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${SPEECH_WAV}`,
          ],
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
