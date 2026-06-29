import { expect, test } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { buildRegistry } from '../../src/discovery/build-registry.ts';

const bootstrap = [
  {
    provider: ProviderKind.Ollama,
    model: 'qwen3.5:4b',
    params: {},
    role: 'r',
    footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
  },
];

test('merges bootstrap + installed + catalog, deduped by (provider,model)', async () => {
  const reg = await buildRegistry({
    bootstrap,
    installed: async () => [
      {
        provider: ProviderKind.Ollama,
        model: 'qwen3.5:9b',
        params: {},
        role: 'i',
        footprint: { approxParamsBillions: 9, bytesPerWeight: 0.56 },
      },
    ],
    readCatalog: () => [
      {
        provider: ProviderKind.Ollama,
        model: 'qwen3.5:4b',
        params: {},
        role: 'c',
        footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
        repo: 'x',
        fileSizeBytes: 1,
        downloads: 1,
        installed: true,
      },
    ],
  });
  expect(reg.map((d) => d.model).sort()).toEqual(['qwen3.5:4b', 'qwen3.5:9b']); // 4b deduped
});

test('offline: installed throws and catalog missing → still returns bootstrap (no throw)', async () => {
  const reg = await buildRegistry({
    bootstrap,
    installed: async () => {
      throw new Error('offline');
    },
    readCatalog: () => undefined,
  });
  expect(reg.map((d) => d.model)).toEqual(['qwen3.5:4b']);
});
