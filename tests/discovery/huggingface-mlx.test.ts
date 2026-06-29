import { afterEach, expect, test } from 'bun:test';
import { Capability, ProviderKind } from '../../src/core/types.ts';
import { hfMlxSource } from '../../src/discovery/huggingface-mlx.ts';

test('applies only when an MLX runtime is present on the host', () => {
  const base = { totalRamBytes: 24e9, liveBudgetBytes: 12e9 };
  expect(
    hfMlxSource.appliesTo({ ...base, runtimes: [ProviderKind.Ollama] }),
  ).toBe(false);
  expect(
    hfMlxSource.appliesTo({
      ...base,
      runtimes: [ProviderKind.Ollama, ProviderKind.MlxServer],
    }),
  ).toBe(true);
});

const orig = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = orig;
});

test('builds an MLX candidate from config.json + chat_template + tree', async () => {
  const routes: Record<string, unknown> = {
    '/api/models?filter=mlx&author=mlx-community&sort=downloads&direction=-1&limit=20':
      [{ id: 'mlx-community/Qwen2.5-7B-Instruct-4bit', downloads: 500 }],
    '/resolve/main/config.json': { num_parameters: 7_600_000_000 },
    '/resolve/main/tokenizer_config.json': {
      chat_template: '{%- if tools %} tool_call',
    },
    '/api/models/mlx-community/Qwen2.5-7B-Instruct-4bit/tree/main': [
      { path: 'model.safetensors', size: 4_300_000_000 },
    ],
  };
  globalThis.fetch = (async (u: string) => {
    const key = Object.keys(routes).find((k) => u.includes(k));
    const body = key ? routes[key] : null;
    return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
  }) as unknown as typeof fetch;

  const cands = await hfMlxSource.listCandidates({
    budgetBytes: 12e9,
    requires: [Capability.Tools],
    hostTotalRamBytes: 24e9,
  });
  expect(cands.length).toBe(1);
  expect(cands[0]!.provider).toBe(ProviderKind.MlxServer);
  expect(cands[0]!.model).toBe('mlx-community/Qwen2.5-7B-Instruct-4bit');
  expect(cands[0]!.capabilities).toContain(Capability.Tools);
});
