import { expect, test } from 'bun:test';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { discoverModels } from '../../src/server/models/discover.ts';

test('discoverModels merges buildRegistry (installed) with fitAndRank over the cached catalog (pullable)', async () => {
  const { installed, pullable } = await discoverModels({
    buildRegistry: async () => [
      {
        runtime: RuntimeKind.Ollama,
        model: 'qwen3.5:9b',
        params: {},
        role: 'installed',
        footprint: { approxParamsBillions: 9, bytesPerWeight: 1 },
      },
    ],
    readCatalog: () => [
      {
        runtime: RuntimeKind.MlxServer,
        model: 'mlx-community/Qwen3.5-30B',
        params: {},
        role: 'catalog',
        footprint: { approxParamsBillions: 30, bytesPerWeight: 1 },
        provider: ProviderKind.HfSnapshot,
        repo: 'mlx-community/Qwen3.5-30B',
        fileSizeBytes: 20_000_000_000,
        downloads: 100,
        installed: false,
      },
    ],
    detectHost: async () => ({
      totalRamBytes: 48e9,
      liveBudgetBytes: 40e9,
      runtimes: [RuntimeKind.Ollama],
    }),
  });
  expect(installed).toHaveLength(1);
  expect(pullable[0]?.provider).toBe(ProviderKind.HfSnapshot);
});
