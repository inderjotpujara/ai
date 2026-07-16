import { expect, test } from 'bun:test';
import type { ModelListResponse } from '../../src/contracts/index.ts';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { handleModelList } from '../../src/server/models/list.ts';

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
