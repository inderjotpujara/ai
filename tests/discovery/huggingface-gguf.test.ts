import { afterEach, expect, test } from 'bun:test';
import { Capability, ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import {
  detectTools,
  hfGgufSource,
} from '../../src/discovery/huggingface-gguf.ts';

test('detectTools reads tool markers from a chat template', () => {
  expect(detectTools('{%- if tools %}...tool_call...')).toBe(true);
  expect(detectTools('plain chat template')).toBe(false);
});

const orig = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = orig;
});

test('builds a fitting tool-capable GGUF candidate', async () => {
  const routes: Record<string, unknown> = {
    '/api/models?filter=gguf&author=bartowski&sort=downloads&direction=-1&limit=20':
      [{ id: 'bartowski/Qwen2.5-7B-Instruct-GGUF', downloads: 9999 }],
    '/api/models/bartowski/Qwen2.5-7B-Instruct-GGUF': {
      gguf: {
        total: 7_600_000_000,
        context_length: 32768,
        chat_template: '{%- if tools %} tool_call',
      },
    },
    '/api/models/bartowski/Qwen2.5-7B-Instruct-GGUF/tree/main': [
      { path: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', size: 4_700_000_000 },
    ],
  };
  globalThis.fetch = (async (u: string) => {
    const path = u.replace('https://huggingface.co', '');
    const body = routes[path] ?? routes[decodeURIComponent(path)];
    return new Response(JSON.stringify(body ?? null), {
      status: body ? 200 : 404,
    });
  }) as unknown as typeof fetch;

  const cands = await hfGgufSource.listCandidates({
    budgetBytes: 12e9,
    requires: [Capability.Tools],
    hostTotalRamBytes: 24e9,
  });
  expect(cands.length).toBe(1);
  const cand = cands[0];
  if (!cand) throw new Error('expected a candidate');
  // GGUF single-file: runs on Ollama, but is fetched via the HF GGUF downloader.
  expect(cand.runtime).toBe(RuntimeKind.Ollama);
  expect(cand.provider).toBe(ProviderKind.HfGguf);
  expect(cand.model).toBe('hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M');
  expect(cand.capabilities).toContain(Capability.Tools);
  expect(cand.quant).toBe('Q4_K_M');
});

test('shard-aware: sums multi-shard Q4_K_M, excludes F16 and mmproj', async () => {
  const routes: Record<string, unknown> = {
    '/api/models?filter=gguf&author=bartowski&sort=downloads&direction=-1&limit=20':
      [{ id: 'bartowski/big-model-GGUF', downloads: 5000 }],
    '/api/models/bartowski/big-model-GGUF': {
      gguf: { chat_template: 'tool_call', context_length: 16384 },
    },
    '/api/models/bartowski/big-model-GGUF/tree/main': [
      {
        path: 'big-model-Q4_K_M-00001-of-00003.gguf',
        lfs: { size: 1_500_000_000 },
      },
      {
        path: 'big-model-Q4_K_M-00002-of-00003.gguf',
        lfs: { size: 1_500_000_000 },
      },
      {
        path: 'big-model-Q4_K_M-00003-of-00003.gguf',
        lfs: { size: 1_500_000_000 },
      },
      { path: 'big-model-F16.gguf', size: 1_200_000_000 },
      { path: 'mmproj-big-model-F16.gguf', size: 500_000_000 },
    ],
  };
  globalThis.fetch = (async (u: string) => {
    const path = u.replace('https://huggingface.co', '');
    const body = routes[path] ?? routes[decodeURIComponent(path)];
    return new Response(JSON.stringify(body ?? null), {
      status: body ? 200 : 404,
    });
  }) as unknown as typeof fetch;

  const cands = await hfGgufSource.listCandidates({
    budgetBytes: 16e9,
    requires: [Capability.Tools],
    hostTotalRamBytes: 32e9,
  });
  expect(cands.length).toBe(1);
  const cand = cands[0];
  if (!cand) throw new Error('expected a candidate');
  expect(cand.quant).toBe('Q4_K_M');
  expect(cand.fileSizeBytes).toBe(4_500_000_000);
  expect(cand.model).toBe('hf.co/bartowski/big-model-GGUF:Q4_K_M');
});

test('budget-too-small: no candidate returned when footprint exceeds budget', async () => {
  const routes: Record<string, unknown> = {
    '/api/models?filter=gguf&author=bartowski&sort=downloads&direction=-1&limit=20':
      [{ id: 'bartowski/big-model-GGUF', downloads: 5000 }],
    '/api/models/bartowski/big-model-GGUF': {
      gguf: { chat_template: 'tool_call', context_length: 16384 },
    },
    '/api/models/bartowski/big-model-GGUF/tree/main': [
      {
        path: 'big-model-Q4_K_M-00001-of-00003.gguf',
        lfs: { size: 1_500_000_000 },
      },
      {
        path: 'big-model-Q4_K_M-00002-of-00003.gguf',
        lfs: { size: 1_500_000_000 },
      },
      {
        path: 'big-model-Q4_K_M-00003-of-00003.gguf',
        lfs: { size: 1_500_000_000 },
      },
      { path: 'big-model-F16.gguf', size: 1_200_000_000 },
      { path: 'mmproj-big-model-F16.gguf', size: 500_000_000 },
    ],
  };
  globalThis.fetch = (async (u: string) => {
    const path = u.replace('https://huggingface.co', '');
    const body = routes[path] ?? routes[decodeURIComponent(path)];
    return new Response(JSON.stringify(body ?? null), {
      status: body ? 200 : 404,
    });
  }) as unknown as typeof fetch;

  const cands = await hfGgufSource.listCandidates({
    budgetBytes: 1e9,
    requires: [Capability.Tools],
    hostTotalRamBytes: 8e9,
  });
  expect(cands.length).toBe(0);
});
