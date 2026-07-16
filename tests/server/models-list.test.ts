import { expect, test } from 'bun:test';
import type { ModelListResponse } from '../../src/contracts/index.ts';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import type { Candidate } from '../../src/discovery/catalog-source.ts';
import { handleModelList } from '../../src/server/models/list.ts';

// REAL persisted catalog rows carry `provider` but NOT `runtime` (the on-disk
// catalog.json predates the field; readCatalog JSON.parses it with an unchecked
// cast). A fixture that sets `runtime` hides the bug this suite regresses, so
// we model the real shape by omitting it and casting exactly as the cache does.
function catalogRow(row: Omit<Candidate, 'runtime'>): Candidate {
  return row as Candidate;
}

const deps = {
  freeDiskBytes: async () => 10_000_000_000,
  discovery: {
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
        provider: ProviderKind.HfSnapshot, // → RuntimeKind.MlxServer via runtimeKindFor
        repo: 'mlx-community/Qwen3.5-30B',
        fileSizeBytes: 20_000_000_000,
        downloads: 100,
        installed: false,
      }),
    ],
    detectHost: async () => ({ liveBudgetBytes: 40e9 }),
  },
};

test('GET /api/models lists installed + pullable rows, flagging a disk shortfall', async () => {
  const res = await handleModelList(deps);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ModelListResponse;
  const installedRow = body.items.find((i) => i.model === 'qwen3.5:9b');
  expect(installedRow?.installed).toBe(true);
  const pullableRow = body.items.find(
    (i) => i.model === 'mlx-community/Qwen3.5-30B',
  );
  expect(pullableRow?.installed).toBe(false);
  expect(pullableRow?.shortfallBytes).toBeGreaterThan(0); // 20GB needed, 10GB free
  // runtime was ABSENT on the cache row — re-derived from HfSnapshot provider.
  expect(pullableRow?.runtime).toBe(RuntimeKind.MlxServer);
});

test('GET /api/models returns 200 (not 500) for realistic pullable rows that carry `provider` but NO `runtime`, deriving a valid RuntimeKind per row (regression: real catalog.json shape)', async () => {
  const res = await handleModelList({
    freeDiskBytes: async () => 100_000_000_000,
    discovery: {
      buildRegistry: async () => [],
      // Exactly the real catalog.json shape: `provider` set, `runtime` absent.
      readCatalog: () => [
        catalogRow({
          model: 'hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_1',
          params: {},
          role: 'discovered',
          footprint: { approxParamsBillions: 9, bytesPerWeight: 0.6 },
          provider: ProviderKind.Ollama, // → RuntimeKind.Ollama
          repo: 'unsloth/Qwen3.5-9B-GGUF',
          quant: 'Q4_1',
          fileSizeBytes: 5_837_251_808,
          downloads: 1_047_718,
          installed: false,
        }),
        catalogRow({
          model: 'mlx-community/Qwen3.5-30B',
          params: {},
          role: 'discovered',
          footprint: { approxParamsBillions: 30, bytesPerWeight: 1 },
          provider: ProviderKind.HfSnapshot, // → RuntimeKind.MlxServer
          repo: 'mlx-community/Qwen3.5-30B',
          fileSizeBytes: 20_000_000_000,
          downloads: 100,
          installed: false,
        }),
      ],
      detectHost: async () => ({ liveBudgetBytes: 60e9 }),
    },
  });
  // Fails against the buggy code: parse threw a ZodError (undefined runtime).
  expect(res.status).toBe(200);
  const body = (await res.json()) as ModelListResponse;
  const runtimes = new Set(body.items.map((i) => i.runtime));
  expect(runtimes.has(RuntimeKind.Ollama)).toBe(true);
  expect(runtimes.has(RuntimeKind.MlxServer)).toBe(true);
  // Every row carries a valid RuntimeKind (no undefined leaks onto the wire).
  const valid = new Set<string>(Object.values(RuntimeKind));
  expect(body.items.every((i) => valid.has(i.runtime))).toBe(true);
});

test('GET /api/models returns a valid empty response when nothing is installed and the catalog is empty', async () => {
  const res = await handleModelList({
    freeDiskBytes: async () => 10_000_000_000,
    discovery: {
      buildRegistry: async () => [],
      readCatalog: () => [],
      detectHost: async () => ({ liveBudgetBytes: 40e9 }),
    },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as ModelListResponse;
  expect(body.items).toEqual([]);
});

test('GET /api/models degrades to installed-only rows when the catalog cache is undefined (readCatalog cache miss)', async () => {
  const res = await handleModelList({
    freeDiskBytes: async () => 10_000_000_000,
    discovery: {
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
      detectHost: async () => ({ liveBudgetBytes: 40e9 }),
    },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as ModelListResponse;
  expect(body.items).toHaveLength(1);
  expect(body.items[0]?.installed).toBe(true);
});

test('GET /api/models does NOT catch a throwing buildRegistry dep — the rejection propagates through handleModelList too (no try/catch wraps discoverModels in list.ts)', async () => {
  await expect(
    handleModelList({
      freeDiskBytes: async () => 10_000_000_000,
      discovery: {
        buildRegistry: async () => {
          throw new Error('runtime down');
        },
        readCatalog: () => [],
        detectHost: async () => ({ liveBudgetBytes: 40e9 }),
      },
    }),
  ).rejects.toThrow('runtime down');
});
