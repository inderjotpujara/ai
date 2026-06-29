import { afterEach, expect, test } from 'bun:test';
import { Capability, ProviderKind } from '../../src/core/types.ts';
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
  const cand = cands[0]!;
  expect(cand.provider).toBe(ProviderKind.Ollama);
  expect(cand.model).toBe('hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M');
  expect(cand.capabilities).toContain(Capability.Tools);
  expect(cand.quant).toBe('Q4_K_M');
});
