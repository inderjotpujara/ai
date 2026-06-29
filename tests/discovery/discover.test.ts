import { expect, test } from 'bun:test';
import { Capability, ProviderKind } from '../../src/core/types.ts';
import { runDiscovery } from '../../src/discovery/discover.ts';

test('fetches from applicable sources, filters/ranks, writes, pre-pulls top-1', async () => {
  const c = (model: string, dl: number, params: number) => ({
    provider: ProviderKind.Ollama, model, params: {}, role: 'r', capabilities: [Capability.Tools],
    footprint: { approxParamsBillions: params, bytesPerWeight: 0.56 },
    repo: model, quant: 'Q4_K_M', fileSizeBytes: params * 0.56e9 * 1.2, downloads: dl, installed: false,
  });
  const pulled: string[] = [];
  const out = await runDiscovery({
    host: { totalRamBytes: 24e9, liveBudgetBytes: 12e9, runtimes: [ProviderKind.Ollama] },
    sources: [{ name: 's', appliesTo: () => true, listCandidates: async () => [c('hf.co/a:Q4_K_M', 10, 7), c('hf.co/b:Q4_K_M', 99, 9)] }],
    writeCatalog: () => {},
    pullTop: async (m) => { pulled.push(m); },
    catalogPathStr: '/tmp/catalog.json',
  });
  expect(out.found).toBe(2);
  expect(pulled).toEqual(['hf.co/b:Q4_K_M']); // highest downloads, pre-pulled
});
