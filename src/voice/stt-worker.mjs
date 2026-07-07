// Runs the sherpa-onnx addon under `node`. Reads one JSON line from stdin
// ({modelDir, sampleRate, samples:[...]}), prints {text} as JSON on stdout,
// and exits. Robust fallback for platforms where the addon can't load
// in-process under Bun (see Task-1 spike / createInProcessTranscriber).
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function loadSherpa() {
  const root = join(process.cwd(), 'node_modules');
  process.env.DYLD_LIBRARY_PATH = [
    join(root, 'sherpa-onnx-node'),
    join(root, 'sherpa-onnx-darwin-arm64'),
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
