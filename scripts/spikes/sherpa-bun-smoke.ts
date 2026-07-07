// Smoke-test whether Bun can load the sherpa-onnx-node N-API addon.
// Run: bun run scripts/spikes/sherpa-bun-smoke.ts
import { join } from 'node:path';

const root = join(process.cwd(), 'node_modules');
// The addon needs its bundled .dylibs on the dyld search path at load time.
process.env.DYLD_LIBRARY_PATH = [
  join(root, 'sherpa-onnx-node'),
  join(root, 'sherpa-onnx-darwin-arm64'),
  process.env.DYLD_LIBRARY_PATH ?? '',
].join(':');

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sherpa = require('sherpa-onnx-node');
  console.log('LOADED', Object.keys(sherpa).slice(0, 12));
  console.log('HAS_OfflineRecognizer', typeof sherpa.OfflineRecognizer);
  process.exit(typeof sherpa.OfflineRecognizer === 'function' ? 0 : 2);
} catch (err) {
  console.error('LOAD_FAILED', (err as Error).message);
  process.exit(1);
}
