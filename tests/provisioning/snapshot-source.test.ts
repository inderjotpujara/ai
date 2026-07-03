import { describe, expect, it } from 'bun:test';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import type { CatalogSource } from '../../src/discovery/catalog-source.ts';
import {
  loadSnapshot,
  withSnapshotFallback,
} from '../../src/provisioning/catalog/snapshot-source.ts';

describe('snapshot', () => {
  it('loads a non-empty committed snapshot with real sizes', () => {
    const snap = loadSnapshot();
    expect(snap.length).toBeGreaterThan(0);
    expect(snap.every((c) => c.fileSizeBytes > 0)).toBe(true);
  });
});

describe('withSnapshotFallback', () => {
  const host = {
    totalRamBytes: 24e9,
    liveBudgetBytes: 8e9,
    runtimes: [RuntimeKind.Ollama],
  };
  const query = { budgetBytes: 8e9, hostTotalRamBytes: 24e9 };
  it('falls back to the snapshot slice when the live source throws', async () => {
    const failing: CatalogSource = {
      name: 'live',
      appliesTo: () => true,
      listCandidates: async () => {
        throw new Error('429');
      },
    };
    const snap: CatalogSource = {
      name: 'snap',
      appliesTo: () => true,
      listCandidates: async () => [
        {
          runtime: RuntimeKind.Ollama,
          provider: ProviderKind.Ollama,
          model: 'qwen3.5:4b',
          params: {},
          role: 'x',
          footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 },
          repo: 'qwen3.5',
          fileSizeBytes: 3e9,
          downloads: 1,
          installed: false,
        },
      ],
    };
    const merged = withSnapshotFallback(failing, snap);
    const out = await merged.listCandidates(query);
    expect(out.map((c) => c.model)).toEqual(['qwen3.5:4b']);
  });
});
