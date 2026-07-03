import { describe, expect, it } from 'bun:test';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { fitAndRank } from '../../src/provisioning/fit.ts';
import type { ProvisionDeps } from '../../src/provisioning/provisioner.ts';
import { runProvision } from '../../src/provisioning/provisioner.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';
import { ATTR } from '../../src/telemetry/spans.ts';
import { registerTestProvider } from '../helpers/otel-test-provider.ts';

const cand = (model: string, params: number, size: number) => ({
  runtime: RuntimeKind.Ollama,
  provider: ProviderKind.Ollama,
  model,
  params: {},
  role: 'x',
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.6 },
  repo: model,
  fileSizeBytes: size,
  downloads: 1,
  installed: false,
});

describe('provisioning eval — fit selection across RAM tiers', () => {
  const catalog = [
    cand('4b', 4, 3e9),
    cand('9b', 9, 6.6e9),
    cand('14b', 14, 9e9),
    cand('32b', 32, 20e9),
  ];

  // Real weights+KV math for this catalog at bytesPerWeight=0.6, ctx=8192,
  // default KV/token (verified by running fitAndRank, not assumed):
  //   4b  -> ~3.95GB   9b -> ~7.55GB   14b -> ~11.15GB   32b -> ~24.11GB
  // A tight 6GB live budget (e.g. an 8GB-unified-memory Mac after OS/runtime
  // overhead) sits strictly between the 4b and 9b footprints.

  it('6GB tight budget recommends 4b only, not 9b/14b/32b', () => {
    const out = fitAndRank(catalog, 6e9);
    expect(out.map((c) => c.model)).toEqual(['4b']);
    expect(out.find((c) => c.recommended)?.model).toBe('4b');
  });

  it('16GB budget (32GB Mac) admits up to 14b but not 32b, recommends 14b', () => {
    const out = fitAndRank(catalog, 16e9);
    expect(out.find((c) => c.recommended)?.model).toBe('14b');
    expect(out.map((c) => c.model)).not.toContain('32b');
    expect(out.map((c) => c.model)).toContain('9b');
  });

  it('28GB budget (64GB Mac) admits up to 32b and recommends the largest', () => {
    const out = fitAndRank(catalog, 28e9);
    expect(out.find((c) => c.recommended)?.model).toBe('32b');
  });

  it('would fail if fitAndRank regressed to always-recommend-largest', () => {
    // Regression guard: a tight budget must NOT recommend the 32b model even
    // though it's the largest in the catalog — recommendation must respect fit.
    const out = fitAndRank(catalog, 6e9);
    const rec = out.find((c) => c.recommended);
    expect(rec).toBeDefined();
    expect(rec?.model).not.toBe('32b');
  });
});

describe('provisioning eval — telemetry span emission', () => {
  it('emits agent.model.provision with candidate/selected/bytes/outcome attrs', async () => {
    const { exporter } = registerTestProvider();

    const selected = [
      {
        ...cand('4b', 4, 3e9),
        estimatedBytes: 3.95e9,
        fits: true,
        recommended: true,
      },
    ];

    const deps: ProvisionDeps = {
      detectHost: async () => ({
        totalRamBytes: 24e9,
        liveBudgetBytes: 8e9,
        runtimes: [RuntimeKind.Ollama],
      }),
      catalogSources: [
        {
          name: 'test-source',
          appliesTo: () => true,
          listCandidates: async () => [cand('4b', 4, 3e9)],
        },
      ],
      providerFor: () => ({
        kind: ProviderKind.Ollama,
        download: async (_modelRef, { onProgress }) => {
          onProgress({
            modelRef: '4b',
            phase: DownloadPhase.Done,
            bytesCompleted: 3e9,
            bytesTotal: 3e9,
            percent: 100,
            speedBytesPerSec: null,
          });
        },
      }),
      enrichSize: async (c) => c.fileSizeBytes,
      freeDiskBytes: async () => 100e9,
      ui: {
        askYesNo: async () => true,
        selectModels: async () => selected,
        bar: { render: () => {}, done: () => {} },
      },
    };

    const result = await runProvision({ deps });
    expect(result.downloaded).toEqual(['4b']);

    const spans = exporter.getFinishedSpans();
    const s = spans.find((sp) => sp.name === 'agent.model.provision');
    expect(s).toBeDefined();
    expect(s?.attributes[ATTR.PROVISION_CANDIDATE_COUNT]).toBe(1);
    expect(s?.attributes[ATTR.PROVISION_SELECTED_COUNT]).toBe(1);
    expect(s?.attributes[ATTR.PROVISION_DOWNLOADED_COUNT]).toBe(1);
    expect(s?.attributes[ATTR.PROVISION_FAILED_COUNT]).toBe(0);
    expect(s?.attributes[ATTR.PROVISION_SNAPSHOT_FALLBACK]).toBe(false);
  });

  it('does NOT emit a provision span for a no-op run (nothing fits)', async () => {
    const { exporter } = registerTestProvider();

    const deps: ProvisionDeps = {
      detectHost: async () => ({
        totalRamBytes: 8e9,
        liveBudgetBytes: 1e9,
        runtimes: [RuntimeKind.Ollama],
      }),
      catalogSources: [
        {
          name: 'test-source',
          appliesTo: () => true,
          listCandidates: async () => [cand('32b', 32, 20e9)],
        },
      ],
      providerFor: () => ({
        kind: ProviderKind.Ollama,
        download: async () => {},
      }),
      enrichSize: async (c) => c.fileSizeBytes,
      freeDiskBytes: async () => 100e9,
      ui: {
        askYesNo: async () => true,
        selectModels: async (items) => items,
        bar: { render: () => {}, done: () => {} },
      },
    };

    const result = await runProvision({ deps });
    expect(result.downloaded).toEqual([]);

    const spans = exporter.getFinishedSpans();
    expect(
      spans.find((sp) => sp.name === 'agent.model.provision'),
    ).toBeUndefined();
  });
});
