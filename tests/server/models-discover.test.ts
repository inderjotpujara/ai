import { expect, test } from 'bun:test';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import type { Candidate } from '../../src/discovery/catalog-source.ts';
import { discoverModels } from '../../src/server/models/discover.ts';

// REAL persisted catalog rows carry `provider` but NOT `runtime` (see
// catalog.json / readCatalog's unchecked cast). Model that shape so the mock
// doesn't paper over the missing-runtime bug.
function catalogRow(row: Omit<Candidate, 'runtime'>): Candidate {
  return row as Candidate;
}

test('discoverModels merges buildRegistry (installed) with fitAndRank over the cached catalog (pullable), re-deriving the runtime absent from the cache row', async () => {
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
      catalogRow({
        model: 'mlx-community/Qwen3.5-30B',
        params: {},
        role: 'catalog',
        footprint: { approxParamsBillions: 30, bytesPerWeight: 1 },
        provider: ProviderKind.HfSnapshot, // → RuntimeKind.MlxServer
        repo: 'mlx-community/Qwen3.5-30B',
        fileSizeBytes: 20_000_000_000,
        downloads: 100,
        installed: false,
      }),
    ],
    detectHost: async () => ({
      totalRamBytes: 48e9,
      liveBudgetBytes: 40e9,
      runtimes: [RuntimeKind.Ollama],
    }),
  });
  expect(installed).toHaveLength(1);
  expect(pullable[0]?.provider).toBe(ProviderKind.HfSnapshot);
  // runtime was absent on the cache row; derived from the provider.
  expect(pullable[0]?.runtime).toBe(RuntimeKind.MlxServer);
});

test('discoverModels drops a catalog row that resolves NO runtime (neither a valid runtime nor a valid provider) rather than surfacing an invalid candidate', async () => {
  const { pullable } = await discoverModels({
    buildRegistry: async () => [],
    readCatalog: () => [
      // Valid provider → kept, runtime derived.
      catalogRow({
        model: 'good/model',
        params: {},
        role: 'catalog',
        footprint: { approxParamsBillions: 4, bytesPerWeight: 1 },
        provider: ProviderKind.Ollama,
        repo: 'good/model',
        fileSizeBytes: 4_000_000_000,
        downloads: 10,
        installed: false,
      }),
      // No runtime AND no valid provider → unresolvable → dropped.
      {
        model: 'bad/model',
        params: {},
        role: 'catalog',
        footprint: { approxParamsBillions: 4, bytesPerWeight: 1 },
        provider: 'NotAProvider',
        repo: 'bad/model',
        fileSizeBytes: 4_000_000_000,
        downloads: 10,
        installed: false,
      } as unknown as Candidate,
    ],
    detectHost: async () => ({
      totalRamBytes: 48e9,
      liveBudgetBytes: 40e9,
      runtimes: [RuntimeKind.Ollama],
    }),
  });
  expect(pullable).toHaveLength(1);
  expect(pullable[0]?.model).toBe('good/model');
  expect(pullable[0]?.runtime).toBe(RuntimeKind.Ollama);
});

test('discoverModels returns an empty-but-valid discovery when nothing is installed and the catalog is empty', async () => {
  const { installed, pullable } = await discoverModels({
    buildRegistry: async () => [],
    readCatalog: () => [],
    detectHost: async () => ({
      totalRamBytes: 48e9,
      liveBudgetBytes: 40e9,
      runtimes: [],
    }),
  });
  expect(installed).toEqual([]);
  expect(pullable).toEqual([]);
});

test('discoverModels degrades to an empty pullable list when readCatalog returns undefined (cache miss) — the `catalog ?? []` guard in discover.ts', async () => {
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
    readCatalog: () => undefined,
    detectHost: async () => ({
      totalRamBytes: 48e9,
      liveBudgetBytes: 40e9,
      runtimes: [RuntimeKind.Ollama],
    }),
  });
  expect(installed).toHaveLength(1);
  expect(pullable).toEqual([]);
});

test('discoverModels does NOT catch a throwing buildRegistry dep — the rejection propagates (documents current non-degrading behavior; the per-runtime try/catch lives inside the real buildRegistry, not in discoverModels)', async () => {
  await expect(
    discoverModels({
      buildRegistry: async () => {
        throw new Error('runtime down');
      },
      readCatalog: () => [],
      detectHost: async () => ({
        totalRamBytes: 48e9,
        liveBudgetBytes: 40e9,
        runtimes: [],
      }),
    }),
  ).rejects.toThrow('runtime down');
});
