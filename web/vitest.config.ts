import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@contracts': resolve(import.meta.dirname, '../src/contracts/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // The real-browser voice e2e (`*.browser.test.ts`) runs ONLY under
    // vitest.browser.config.ts (Chromium + fake-audio, downloads models) —
    // keep it out of the fast happy-dom suite and `bun run check`.
    exclude: [...configDefaults.exclude, '**/*.browser.test.ts'],
  },
});
