import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// COOP/COEP so the frontend can use transformers.js's threaded WASM backend
// (SharedArrayBuffer) for STT/VAD inference (Slice 30b Phase 7, D1/D8 —
// originally put in place for a since-rejected sherpa-onnx WASM plan, see
// docs/architecture.md's Voice section). The model-weight CDN fetch under
// `require-corp` was proven/adjusted by the Task 7 D10 spike — see
// `web/src/features/voice/stt.worker.ts`'s header comment for which rung of
// the fallback ladder this repo actually ships on.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@contracts': resolve(import.meta.dirname, '../src/contracts/index.ts'),
    },
  },
  server: { headers: isolation, fs: { allow: ['..'] } },
  preview: { headers: isolation },
  // stt.worker.ts is instantiated with `new Worker(url, { type: 'module' })`
  // (D4) and statically imports `@huggingface/transformers`, which itself
  // does dynamic `import()` for its backend selection — Vite's default
  // worker output format ('iife') can't express that, so the worker bundle
  // must build as an ES module to match how it's constructed.
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // transformers.js ships its own WASM/ONNX binaries; excluding it from
    // esbuild's dependency pre-bundling avoids the dev server trying (and
    // failing) to pre-process large binary assets as JS.
    exclude: ['@huggingface/transformers'],
  },
});
