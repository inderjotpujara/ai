### Task 7: D10 browser spike (manual) + `stt.worker.ts` scaffold (message protocol + transformers.js wiring)

**This task OPENS with the spec's mandated D10 spike — a real-browser check that must happen BEFORE any of this task's code is considered final.** The spec's own words (§3, D10): "Increment 3 therefore OPENS with a ≤1-hour spike: in a real Chrome tab served with the app's actual headers, load `moonshine-tiny` + `silero-vad` through transformers.js and transcribe a buffer... The spike picks the lowest rung that works; the plan records which." This is a manual verification step, not an automated test — the worker code below is written to the best-known shape of the transformers.js v4.2.0 API and is the artifact the spike proves (or requires correcting).

**Files:**
- Create: `web/src/features/voice/stt.worker.ts`
- No automated test this task (see the manual spike checklist in Step 1 — this file runs inside a Web Worker with a real ONNX/WASM runtime, which cannot execute under happy-dom/Vitest; `stt-engine.ts`'s message-protocol handling, the part that IS unit-testable, is Task 8).

**Interfaces:**
- Consumes: `ModelTier` (defined here, Task 7, as the canonical home — Task 8 imports it from here; Task 4's Settings temporary local `ModelTier` gets superseded in Task 8, not this task).
- Produces: `SttWorkerRequest` / `SttWorkerResponse` message-protocol types (`{kind:'load'|'detectSpeech'|'transcribe', ...}` / `{kind:'progress'|'ready'|'detectSpeechResult'|'transcribeResult'|'error', ...}`), consumed by `stt-engine.ts` (Task 8) on the main-thread side of the same `postMessage` contract.

- [ ] **Step 1: Run the D10 spike (manual verification — do this FIRST, before trusting the code below)**

1. Build and serve the app with its real production-shaped headers:
   ```bash
   cd web && bun run build && bun run preview
   ```
   (`bun run preview` serves the built app with `web/vite.config.ts`'s `preview.headers` — the same `Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Embedder-Policy: require-corp` pair the production server (`src/server/isolation-headers.ts`) uses.)
2. Open the served URL (printed by `bun run preview`, typically `http://localhost:4173`) in a **real Chrome tab** using the native `/chrome` integration (per this repo's CLAUDE.md: prefer native Chrome over Playwright for anything needing a real browser).
3. Open DevTools → Console, and paste in a scratch script that mirrors exactly what `stt.worker.ts` (Step 3 below) does:
   ```js
   const { AutoModel, AutoProcessor, env } = await import('@huggingface/transformers');
   env.useBrowserCache = true;
   console.log('crossOriginIsolated:', window.crossOriginIsolated);
   const model = await AutoModel.from_pretrained('onnx-community/moonshine-tiny-ONNX', { device: 'wasm' });
   const vad = await AutoModel.from_pretrained('onnx-community/silero-vad', { device: 'wasm' });
   console.log('loaded ok', model, vad);
   ```
4. **Decide the outcome** against D10's fallback ladder:
   - **Rung 1 (expected default):** the script above completes with no CORS/CORP console errors and `loaded ok` prints → the model CDN fetch works unchanged under `require-corp`. **No header changes needed.** Proceed to Step 3 below as written.
   - **Rung 2:** if Rung 1 fails with a CORP-related network error, change `Cross-Origin-Embedder-Policy` from `require-corp` to `credentialless` in BOTH `web/vite.config.ts`'s `isolation` object and `src/server/isolation-headers.ts`'s `ISOLATION_HEADERS`, rebuild/re-preview, and re-run the script.
   - **Rung 3:** if Rung 2 also fails (browser lacks `credentialless` support), self-hosting the model files (a `bun run setup:voice-web` provisioning script, mirroring the CLI's `scripts/setup-voice.ts`) is required — this is a larger follow-up NOT built in this task; flag it to the controller for a dedicated task insertion before Part B's live-verify (Task 18).
5. **Record the outcome** as a one-line code comment at the top of `stt.worker.ts` (Step 3 below already includes a placeholder line for this — fill in the actual rung reached) — this is the plan's/ledger's record per the spec's "the plan records which."

- [ ] **Step 2: (No failing-test step for this task — see the Files note above.)**

- [ ] **Step 3: Write the worker implementation**

Create `web/src/features/voice/stt.worker.ts`:

```ts
// D10 SPIKE OUTCOME (Task 7, filled in at execution time — see Step 1 above):
// Rung reached: ___ (1 = unchanged require-corp; 2 = credentialless; 3 =
// self-hosted models). Fill this in before this task's commit.
//
// Runs inside a dedicated Web Worker (D4) — transformers.js's heavier
// VAD+ASR inference stays off the main UI thread. This file is NOT
// unit-tested directly (no WASM/ONNX runtime under happy-dom/Vitest);
// `stt-engine.ts` (Task 8) tests the main-thread side of this exact message
// protocol against a fully mocked `Worker` global. The transformers.js API
// call shapes below reflect the D10 spike's proven-working invocation —
// adjust them to match whatever the spike actually found, if it differs.
import {
  AutoModel,
  AutoProcessor,
  env,
  type PreTrainedModel,
  type Processor,
} from '@huggingface/transformers';

export type ModelTier = 'moonshine-base' | 'moonshine-tiny';

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
  'moonshine-base': 'onnx-community/moonshine-base-ONNX',
  'moonshine-tiny': 'onnx-community/moonshine-tiny-ONNX',
};
const VAD_MODEL_ID = 'onnx-community/silero-vad';

env.useBrowserCache = true; // D1/D7: Cache-API persistence, skip re-download on reload

let asrModel: PreTrainedModel | undefined;
let asrProcessor: Processor | undefined;
let vadModel: PreTrainedModel | undefined;

function post(msg: SttWorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

async function detectWebGpuDevice(): Promise<'webgpu' | 'wasm'> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return 'wasm';
  try {
    const adapter = await gpu.requestAdapter();
    return adapter !== null ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm'; // D9: never crash on a capability-detection failure
  }
}

async function load(model: ModelTier): Promise<void> {
  const device = await detectWebGpuDevice();
  const modelId = MODEL_IDS[model];
  const progress = (info: { loaded: number; total: number }) => {
    post({ kind: 'progress', loaded: info.loaded, total: info.total });
  };
  asrModel = (await AutoModel.from_pretrained(modelId, {
    device,
    progress_callback: progress,
  })) as PreTrainedModel;
  asrProcessor = (await AutoProcessor.from_pretrained(modelId, {})) as Processor;
  vadModel = (await AutoModel.from_pretrained(VAD_MODEL_ID, { device })) as PreTrainedModel;
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
  const output = await asrModel.generate({ ...inputs, max_new_tokens: 256 });
  const [text] = asrProcessor.batch_decode(output, { skip_special_tokens: true });
  return text ?? '';
}

self.onmessage = (event: MessageEvent<SttWorkerRequest>) => {
  const msg = event.data;
  if (msg.kind === 'load') {
    load(msg.model).catch((err: unknown) => {
      post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    });
    return;
  }
  if (msg.kind === 'detectSpeech') {
    detectSpeech(msg.chunk)
      .then((isSpeech) => post({ kind: 'detectSpeechResult', id: msg.id, isSpeech }))
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
```

Note: the worker message protocol deliberately carries a bare `samples: Float32Array`, not the full `VoiceFrames` shape — `sampleRate` is always the fixed `16000` (`VoiceFrames`'s literal type), so `stt-engine.ts` (Task 8) unpacks `frames.samples` before posting, and this file never needs to import `VoiceFrames` itself.

- [ ] **Step 4: Verify it compiles (no automated behavioral test — see Files note)**

Run: `cd web && bun run typecheck`
Expected: PASS. This confirms the transformers.js import shapes and message-protocol types are internally consistent; it does NOT prove the model actually loads in a browser — that's what Step 1's spike already proved (or corrected) before this step.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/voice/stt.worker.ts
git commit -m "feat(voice): stt.worker.ts — transformers.js Moonshine+Silero worker, D10 spike outcome recorded"
```

