// Build-artifact guard for the AudioWorklet chunk (Slice 30b Phase 7).
//
// Guards the EXACT prod-build regression a Vite-dev browser test cannot: the
// downsample worklet must be emitted by the Rolldown production build as a
// servable JS chunk containing `registerProcessor`. The original defect
// (`new URL('./x.ts', import.meta.url)` shipping a raw, unservable `.ts` URL
// to `addModule`) only broke in the build, never in dev — so this runs after
// `vite build` in the `test:voice-e2e` script.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ASSETS_DIR = join(import.meta.dirname, '..', 'dist', 'assets');

async function main(): Promise<void> {
  let files: string[];
  try {
    files = await readdir(ASSETS_DIR);
  } catch {
    throw new Error(
      `dist/assets not found at ${ASSETS_DIR} — run \`vite build\` first`,
    );
  }

  const jsChunks = files.filter((f) => f.endsWith('.js'));
  const matches: string[] = [];
  for (const file of jsChunks) {
    const body = await readFile(join(ASSETS_DIR, file), 'utf8');
    if (body.includes('registerProcessor')) matches.push(file);
  }

  if (matches.length === 0) {
    throw new Error(
      'No built JS chunk contains `registerProcessor` — the AudioWorklet ' +
        'was not emitted by the production build (regression: worklet not ' +
        'built as a servable chunk).',
    );
  }

  console.log(
    `worklet build guard OK: registerProcessor found in ${matches.join(', ')}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
