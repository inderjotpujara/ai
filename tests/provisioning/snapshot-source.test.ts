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

  const makeCandidate = (model: string) => [
    {
      runtime: RuntimeKind.Ollama,
      provider: ProviderKind.Ollama,
      model,
      params: {},
      role: 'x',
      footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 },
      repo: 'qwen3.5',
      fileSizeBytes: 3e9,
      downloads: 1,
      installed: false,
    },
  ];

  const snap: CatalogSource = {
    name: 'snap',
    appliesTo: () => true,
    listCandidates: async () => makeCandidate('qwen3.5:4b'),
  };

  it('usedSnapshotFallback() is false after a live, non-empty listCandidates() call', async () => {
    const live: CatalogSource = {
      name: 'live',
      appliesTo: () => true,
      listCandidates: async () => makeCandidate('live-model:1b'),
    };
    const merged = withSnapshotFallback(live, snap);
    const out = await merged.listCandidates(query);
    expect(out.map((c) => c.model)).toEqual(['live-model:1b']);
    expect(merged.usedSnapshotFallback?.()).toBe(false);
  });

  it('usedSnapshotFallback() is true after the live source returns empty', async () => {
    const empty: CatalogSource = {
      name: 'live',
      appliesTo: () => true,
      listCandidates: async () => [],
    };
    const merged = withSnapshotFallback(empty, snap);
    const out = await merged.listCandidates(query);
    expect(out.map((c) => c.model)).toEqual(['qwen3.5:4b']);
    expect(merged.usedSnapshotFallback?.()).toBe(true);
  });

  it('usedSnapshotFallback() is true after the live source throws', async () => {
    const failing: CatalogSource = {
      name: 'live',
      appliesTo: () => true,
      listCandidates: async () => {
        throw new Error('429');
      },
    };
    const merged = withSnapshotFallback(failing, snap);
    await merged.listCandidates(query);
    expect(merged.usedSnapshotFallback?.()).toBe(true);
  });

  it('resets usedSnapshotFallback() back to false on a subsequent live, non-empty call', async () => {
    let shouldFail = true;
    const flaky: CatalogSource = {
      name: 'live',
      appliesTo: () => true,
      listCandidates: async () => {
        if (shouldFail) throw new Error('429');
        return makeCandidate('live-model:1b');
      },
    };
    const merged = withSnapshotFallback(flaky, snap);

    // First call: live throws, falls back to snapshot.
    await merged.listCandidates(query);
    expect(merged.usedSnapshotFallback?.()).toBe(true);

    // Second call: live recovers, must reset the flag.
    shouldFail = false;
    const out = await merged.listCandidates(query);
    expect(out.map((c) => c.model)).toEqual(['live-model:1b']);
    expect(merged.usedSnapshotFallback?.()).toBe(false);
  });
});
