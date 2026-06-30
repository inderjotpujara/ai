import { expect, test } from 'bun:test';
import { Capability, ProviderKind } from '../../src/core/types.ts';
import { runDiscovery } from '../../src/discovery/discover.ts';

const makeCandidate = (model: string, dl: number, params: number) => ({
  provider: ProviderKind.Ollama,
  model,
  params: {},
  role: 'r',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.56 },
  repo: model,
  quant: 'Q4_K_M',
  fileSizeBytes: params * 0.56e9 * 1.2,
  downloads: dl,
  installed: false,
});

test('fetches from applicable sources, filters/ranks, writes, pre-pulls top-1', async () => {
  const pulled: string[] = [];
  const out = await runDiscovery({
    host: {
      totalRamBytes: 24e9,
      liveBudgetBytes: 12e9,
      runtimes: [ProviderKind.Ollama],
    },
    sources: [
      {
        name: 's',
        appliesTo: () => true,
        listCandidates: async () => [
          makeCandidate('hf.co/a:Q4_K_M', 10, 7),
          makeCandidate('hf.co/b:Q4_K_M', 99, 9),
        ],
      },
    ],
    writeCatalog: () => {},
    pullTop: async (m) => {
      pulled.push(m);
    },
    catalogPathStr: '/tmp/catalog.json',
  });
  expect(out.found).toBe(2);
  expect(pulled).toEqual(['hf.co/b:Q4_K_M']); // highest downloads, pre-pulled
});

test('failing pullTop populates pullFailed', async () => {
  const out = await runDiscovery({
    host: {
      totalRamBytes: 24e9,
      liveBudgetBytes: 12e9,
      runtimes: [ProviderKind.Ollama],
    },
    sources: [
      {
        name: 's',
        appliesTo: () => true,
        listCandidates: async () => [
          makeCandidate('hf.co/good:Q4_K_M', 99, 7),
          makeCandidate('hf.co/bad:Q4_K_M', 50, 7),
        ],
      },
    ],
    writeCatalog: () => {},
    pullTop: async (m) => {
      if (m === 'hf.co/good:Q4_K_M') return;
      throw new Error('connection refused');
    },
    catalogPathStr: '/tmp/catalog.json',
    prePullCount: 2,
  });
  expect(out.pulled).toContain('hf.co/good:Q4_K_M');
  expect(out.pulled).not.toContain('hf.co/bad:Q4_K_M');
  expect(out.pullFailed).toHaveLength(1);
  const failure = out.pullFailed[0];
  if (!failure) throw new Error('expected a failure entry');
  expect(failure.model).toBe('hf.co/bad:Q4_K_M');
  expect(failure.reason.length).toBeGreaterThan(0);
});
