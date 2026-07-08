import { expect, test } from 'bun:test';
import { collectStatus, renderStatus } from '../../src/cli/status.ts';

test('collectStatus assembles a report from injected probes', async () => {
  const r = await collectStatus({
    ollamaReachable: async () => true,
    loadedModels: async () => ['qwen2.5:14b'],
    freeBudgetBytes: async () => 12_000_000_000,
    version: '0.2.0',
  });
  expect(r).toEqual({
    version: '0.2.0',
    ollama: true,
    loaded: ['qwen2.5:14b'],
    freeGb: 12,
  });
  expect(renderStatus(r)).toContain('qwen2.5:14b');
});
