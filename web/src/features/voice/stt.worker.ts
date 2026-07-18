// D10: built on Rung 1 (require-corp + CDN CORS fetch); to be confirmed at
// Task 17 live-verify. Fallback ladder if CDN blocked: (2) COEP
// credentialless, (3) self-host models via env.localModelPath. See spec D10.
//
// Runs inside a dedicated Web Worker (D4) — transformers.js's heavier
// VAD+ASR inference stays off the main UI thread. This file is NOT
// unit-tested directly (no WASM/ONNX runtime under happy-dom/Vitest);
// `stt-engine.ts` (Task 8) tests the main-thread side of this exact message
// protocol against a fully mocked `Worker` global. The one piece of pure
// logic worth isolating — WebGPU device detection — IS exported and unit
// tested here (see stt.worker.test.ts); everything past that boundary
// (actual model load/inference) is validated at Part B live-verify
// (Task 18/T17), not by an automated test.
import {
  AutoModel,
  AutoProcessor,
  env,
  type PreTrainedModel,
  type Processor,
  type ProgressInfo,
  type Tensor,
} from '@huggingface/transformers';
import { ModelTier } from './model-tier.ts';

/** Canonical `ModelTier` now lives in `./model-tier.ts` (Task 8) — re-export
 * so existing importers of it from this module keep working. */
export { ModelTier };

export type SttWorkerRequest =
  | { kind: 'load'; model: ModelTier }
  | { kind: 'detectSpeech'; id: number; chunk: Float32Array }
  | { kind: 'transcribe'; id: number; samples: Float32Array };

export type SttWorkerResponse =
  | { kind: 'progress'; loaded: number; total: number }
  | { kind: 'ready' }
  | { kind: 'detectSpeechResult'; id: number; isSpeech: boolean }
  | { kind: 'transcribeResult'; id: number; text: string }
  | { kind: 'error'; id?: number; message: string };

const MODEL_IDS: Record<ModelTier, string> = {
  [ModelTier.Base]: 'onnx-community/moonshine-base-ONNX',
  [ModelTier.Tiny]: 'onnx-community/moonshine-tiny-ONNX',
};
const VAD_MODEL_ID = 'onnx-community/silero-vad';

env.useBrowserCache = true; // D1/D7: Cache-API persistence, skip re-download on reload

let asrModel: PreTrainedModel | undefined;
let asrProcessor: Processor | undefined;
let vadModel: PreTrainedModel | undefined;

function post(msg: SttWorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

/** WebGPU-detect → WASM fallback. Exported and unit-tested in isolation
 * (mocked `navigator.gpu`) — everything downstream of the returned device
 * string is real transformers.js/ONNX work that only a real browser proves. */
export async function detectWebGpuDevice(): Promise<'webgpu' | 'wasm'> {
  const gpu = (
    navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }
  ).gpu;
  if (!gpu) return 'wasm';
  try {
    const adapter = await gpu.requestAdapter();
    return adapter !== null ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm'; // D9: never crash on a capability-detection failure
  }
}

function progressOf(
  info: ProgressInfo,
): { loaded: number; total: number } | undefined {
  if ('loaded' in info && 'total' in info) {
    return { loaded: info.loaded, total: info.total };
  }
  return undefined;
}

async function load(model: ModelTier): Promise<void> {
  const device = await detectWebGpuDevice();
  const modelId = MODEL_IDS[model];
  const progress_callback = (info: ProgressInfo) => {
    const bytes = progressOf(info);
    if (bytes)
      post({ kind: 'progress', loaded: bytes.loaded, total: bytes.total });
  };
  asrModel = (await AutoModel.from_pretrained(modelId, {
    device,
    progress_callback,
  })) as PreTrainedModel;
  asrProcessor = await AutoProcessor.from_pretrained(modelId, {});
  vadModel = (await AutoModel.from_pretrained(VAD_MODEL_ID, {
    device,
  })) as PreTrainedModel;
  post({ kind: 'ready' });
}

async function detectSpeech(chunk: Float32Array): Promise<boolean> {
  if (!vadModel) throw new Error('VAD model not loaded — call load() first');
  const result = (await vadModel({ input: chunk })) as {
    output?: { data?: ArrayLike<number> };
  };
  const score = Number(result.output?.data?.[0] ?? 0);
  return score > 0.5;
}

async function transcribe(samples: Float32Array): Promise<string> {
  if (!asrModel || !asrProcessor) {
    throw new Error('ASR model not loaded — call load() first');
  }
  const inputs = await asrProcessor(samples);
  const output = (await asrModel.generate({
    ...inputs,
    max_new_tokens: 256,
  })) as Tensor;
  const [text] = asrProcessor.batch_decode(output, {
    skip_special_tokens: true,
  });
  return text ?? '';
}

self.onmessage = (event: MessageEvent<SttWorkerRequest>) => {
  const msg = event.data;
  if (msg.kind === 'load') {
    load(msg.model).catch((err: unknown) => {
      post({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
    return;
  }
  if (msg.kind === 'detectSpeech') {
    detectSpeech(msg.chunk)
      .then((isSpeech) =>
        post({ kind: 'detectSpeechResult', id: msg.id, isSpeech }),
      )
      .catch((err: unknown) => {
        post({
          kind: 'error',
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }
  if (msg.kind === 'transcribe') {
    transcribe(msg.samples)
      .then((text) => post({ kind: 'transcribeResult', id: msg.id, text }))
      .catch((err: unknown) => {
        post({
          kind: 'error',
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }
};
