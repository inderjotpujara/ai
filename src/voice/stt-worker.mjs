// Runs the sherpa-onnx addon under `node`. Reads one JSON line from stdin
// ({modelDir, sampleRate, samples:[...]}), prints {text} as JSON on stdout,
// and exits. Robust fallback for platforms where the addon can't load
// in-process under Bun (see Task-1 spike / createInProcessTranscriber).
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

const require = createRequire(import.meta.url);

// Resolves the sherpa-onnx dylib dirs from the addon's INSTALLED location
// (via require.resolve), never from process.cwd() — cwd-relative resolution
// would (a) load an attacker-controlled dylib if this worker is ever spawned
// against an untrusted cwd containing its own
// node_modules/sherpa-onnx-darwin-arm64, and (b) break voice whenever chat
// is launched from anywhere other than the repo root.
function resolveSherpaDyldDirs() {
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

function loadSherpa() {
  process.env.DYLD_LIBRARY_PATH = [
    ...resolveSherpaDyldDirs(),
    process.env.DYLD_LIBRARY_PATH ?? '',
  ].join(':');
  return require('sherpa-onnx-node');
}

let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
});
process.stdin.on('end', () => {
  try {
    const { modelDir, sampleRate, samples } = JSON.parse(buf);
    const sherpa = loadSherpa();
    const recognizer = new sherpa.OfflineRecognizer({
      modelConfig: {
        moonshine: {
          preprocessor: join(modelDir, 'preprocess.onnx'),
          encoder: join(modelDir, 'encode.int8.onnx'),
          uncachedDecoder: join(modelDir, 'uncached_decode.int8.onnx'),
          cachedDecoder: join(modelDir, 'cached_decode.int8.onnx'),
        },
        tokens: join(modelDir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
      },
    });
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate, samples: Float32Array.from(samples) });
    recognizer.decode(stream);
    const text = String(recognizer.getResult(stream).text ?? '').trim();
    process.stdout.write(JSON.stringify({ text }));
    process.exit(0);
  } catch (err) {
    process.stderr.write(String(err));
    process.exit(1);
  }
});
