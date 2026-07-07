// Smoke-test whether Bun can load the sherpa-onnx-node N-API addon.
// Run: bun run scripts/spikes/sherpa-bun-smoke.ts
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

const require = createRequire(import.meta.url);

// Resolve from the addon's INSTALLED location (require.resolve), not
// process.cwd() — see src/voice/transcribe.ts's resolveSherpaDyldDirs for
// the full rationale (cwd-relative resolution is both a hijack risk and
// breaks whenever this script runs from outside the repo root).
function resolveSherpaDyldDirs(): string[] {
  const resolved = require.resolve('sherpa-onnx-node');
  const marker = `${sep}node_modules${sep}sherpa-onnx-node${sep}`;
  const idx = resolved.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      `could not locate the sherpa-onnx-node install root from ${resolved}`,
    );
  }
  const nodeModulesRoot = resolved.slice(0, idx + `${sep}node_modules`.length);
  return [
    join(nodeModulesRoot, 'sherpa-onnx-node'),
    join(nodeModulesRoot, 'sherpa-onnx-darwin-arm64'),
  ];
}

// The addon needs its bundled .dylibs on the dyld search path at load time.
process.env.DYLD_LIBRARY_PATH = [
  ...resolveSherpaDyldDirs(),
  process.env.DYLD_LIBRARY_PATH ?? '',
].join(':');

try {
  const sherpa = require('sherpa-onnx-node');
  console.log('LOADED', Object.keys(sherpa).slice(0, 12));
  console.log('HAS_OfflineRecognizer', typeof sherpa.OfflineRecognizer);
  process.exit(typeof sherpa.OfflineRecognizer === 'function' ? 0 : 2);
} catch (err) {
  console.error('LOAD_FAILED', (err as Error).message);
  process.exit(1);
}
