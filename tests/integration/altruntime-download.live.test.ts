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

// Exact model ids are placeholders — confirmed against genuinely tiny,
// license-clear models when Task 17 wires up the real runtimes.
const LMSTUDIO_TINY_MODEL = 'lmstudio-community/tinyllama-1.1b-chat-v1.0';
const HF_GGUF_MODEL_REF =
  'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF::tinyllama-1.1b-chat-v1.0.Q2_K.gguf';

describe.skipIf(!LIVE)('altruntime download live-verify', () => {
  test('LM Studio: downloads a tiny model and reaches DownloadPhase.Done', async () => {
    const provider = createLmStudioProvider();
    const dest = mkdtempSync(join(tmpdir(), 'altruntime-lmstudio-'));
    const phases: DownloadPhase[] = [];
    await provider.download(LMSTUDIO_TINY_MODEL, {
      onProgress: (p) => phases.push(p.phase),
      signal: new AbortController().signal,
      destDir: dest,
    });
    expect(phases.at(-1)).toBe(DownloadPhase.Done);
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
