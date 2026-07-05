import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderKind } from '../../src/core/types.ts';
import { createHfFetchProvider } from '../../src/provisioning/providers/hf-fetch.ts';
import { createLmStudioProvider } from '../../src/provisioning/providers/lmstudio.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

// Gated: a real LM Studio daemon (localhost:1234) and real network access to
// HuggingFace are required. Run with:
//   ALTRUNTIME_LIVE=1 bun test tests/integration/altruntime-download.live.test.ts
const LIVE = process.env.ALTRUNTIME_LIVE === '1';

// Real, genuinely-tiny (0.5B) refs confirmed live in Task 17.
// NOTE (surfaced by live-verify): LM Studio's local download REST API
// (`POST /api/v1/models/download`) requires a HuggingFace model URL for
// community models — a bare `publisher/repo` artifact id is rejected
// ("Downloading community models as artifacts is not supported"). The
// adapter forwards the ref verbatim, so callers pass the HF URL form.
const LMSTUDIO_TINY_MODEL =
  process.env.ALTRUNTIME_LMSTUDIO_DL ??
  'https://huggingface.co/lmstudio-community/Qwen2.5-0.5B-Instruct-GGUF';
const HF_GGUF_MODEL_REF =
  process.env.ALTRUNTIME_HF_GGUF ??
  'bartowski/Qwen2.5-0.5B-Instruct-GGUF::Qwen2.5-0.5B-Instruct-Q4_K_M.gguf';

describe.skipIf(!LIVE)('altruntime download live-verify', () => {
  test('LM Studio: starts a real download job and polls live progress via the daemon', async () => {
    // Verifies the adapter's real-API integration end to end: POST start →
    // real job_id → poll the status endpoint → normalized Downloading progress
    // with real bytes. We abort once real progress is observed rather than
    // waiting for 100% (a 0.5B GGUF is ~0.5GB and network-bound here; the
    // completed→Done branch is covered by the unit test). This is the exact
    // path where live-verify caught the wrong poll URL (`/download/{id}` →
    // `/download/status/{id}`).
    const provider = createLmStudioProvider({ pollMs: 500 });
    const dest = mkdtempSync(join(tmpdir(), 'altruntime-lmstudio-'));
    const controller = new AbortController();
    let sawDownloadingBytes = false;
    const run = provider
      .download(LMSTUDIO_TINY_MODEL, {
        onProgress: (p) => {
          if (
            (p.phase === DownloadPhase.Downloading ||
              p.phase === DownloadPhase.Done) &&
            p.bytesCompleted > 0
          ) {
            sawDownloadingBytes = true;
            controller.abort(); // stop after confirming real polled progress
          }
        },
        signal: controller.signal,
        destDir: dest,
      })
      .catch((err) => {
        // an abort after real progress is the success path here
        if (!String(err).includes('aborted')) throw err;
      });
    await run;
    expect(sawDownloadingBytes).toBe(true);
  }, 300_000);

  test('llama.cpp: fetches a real GGUF file to a temp dir and it is non-zero', async () => {
    const provider = createHfFetchProvider(ProviderKind.HfGguf);
    const dest = mkdtempSync(join(tmpdir(), 'altruntime-hfgguf-'));
    await provider.download(HF_GGUF_MODEL_REF, {
      onProgress: () => {},
      signal: new AbortController().signal,
      destDir: dest,
    });
    const file = HF_GGUF_MODEL_REF.split('::')[1] ?? '';
    const outPath = join(dest, file);
    expect(existsSync(outPath)).toBe(true);
    expect(statSync(outPath).size).toBeGreaterThan(0);
  }, 300_000);
});
