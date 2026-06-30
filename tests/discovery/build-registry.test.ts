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

const catalogEntry = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:4b',
  params: {},
  role: 'c',
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
  repo: 'x',
  fileSizeBytes: 1,
  downloads: 1,
  installed: true,
};

const catalogEntryNew = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:14b',
  params: {},
  role: 'c',
  footprint: { approxParamsBillions: 14, bytesPerWeight: 0.56 },
  repo: 'y',
  fileSizeBytes: 2,
  downloads: 2,
  installed: false,
};

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
    readCatalog: () => [catalogEntry],
    isInstalled: async () => true,
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

test('catalog candidate with isInstalled returning false is excluded', async () => {
  const reg = await buildRegistry({
    bootstrap,
    installed: async () => [],
    readCatalog: () => [catalogEntryNew],
    isInstalled: async () => false,
  });
  // only bootstrap; catalog entry excluded because not installed
  expect(reg.map((d) => d.model)).toEqual(['qwen3.5:4b']);
});

test('catalog candidate with isInstalled returning true is included', async () => {
  const reg = await buildRegistry({
    bootstrap,
    installed: async () => [],
    readCatalog: () => [catalogEntryNew],
    isInstalled: async () => true,
  });
  // bootstrap + catalog entry both present
  expect(reg.map((d) => d.model).sort()).toEqual(['qwen3.5:14b', 'qwen3.5:4b']);
});

test('catalog candidate is excluded when isInstalled probe throws (offline-safe)', async () => {
  const reg = await buildRegistry({
    bootstrap,
    installed: async () => [],
    readCatalog: () => [catalogEntryNew],
    isInstalled: async () => {
      throw new Error('runtime offline');
    },
  });
  // probe threw → candidate excluded; only bootstrap survives
  expect(reg.map((d) => d.model)).toEqual(['qwen3.5:4b']);
});
