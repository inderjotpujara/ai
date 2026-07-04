import { afterEach, expect, spyOn, test } from 'bun:test';
import { Capability, ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { runDiscovery } from '../../src/discovery/discover.ts';

afterEach(() => {
  (globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();
});

const makeCandidate = (model: string, dl: number, params: number) => ({
  runtime: RuntimeKind.Ollama,
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
      runtimes: [RuntimeKind.Ollama],
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
      runtimes: [RuntimeKind.Ollama],
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

test('default pre-pull routes an Ollama-runtime candidate to the daemon, not providerFor', async () => {
  // Regression: a HfGguf-provider candidate whose model is an Ollama-native
  // `hf.co/<repo>:<quant>` ref must still pull via the Ollama daemon (it
  // resolves hf.co refs natively) — routing on download `provider` instead
  // of inference `runtime` would send this to providerFor(HfGguf).download
  // and build a malformed huggingface.co URL.
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{}', { status: 200 }),
  );
  const candidate = {
    ...makeCandidate('hf.co/foo:Q4_K_M', 99, 7),
    runtime: RuntimeKind.Ollama,
    provider: ProviderKind.HfGguf,
  };
  await runDiscovery({
    host: {
      totalRamBytes: 24e9,
      liveBudgetBytes: 12e9,
      runtimes: [RuntimeKind.Ollama],
    },
    sources: [
      {
        name: 's',
        appliesTo: () => true,
        listCandidates: async () => [candidate],
      },
    ],
    writeCatalog: () => {},
    catalogPathStr: '/tmp/catalog.json',
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url] = fetchSpy.mock.calls[0] as [string];
  expect(url).toContain('/api/pull'); // Ollama daemon endpoint, not huggingface.co
});

test('default pre-pull routes a non-Ollama-runtime candidate to providerFor', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(new ReadableStream({ start: (c) => c.close() }), {
      status: 200,
    }),
  );
  const candidate = {
    ...makeCandidate('org/repo', 99, 7),
    runtime: RuntimeKind.MlxServer,
    provider: ProviderKind.HfSnapshot,
  };
  await runDiscovery({
    host: {
      totalRamBytes: 24e9,
      liveBudgetBytes: 12e9,
      runtimes: [RuntimeKind.MlxServer],
    },
    sources: [
      {
        name: 's',
        appliesTo: () => true,
        listCandidates: async () => [candidate],
      },
    ],
    writeCatalog: () => {},
    catalogPathStr: '/tmp/catalog.json',
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url] = fetchSpy.mock.calls[0] as [string];
  expect(url).toContain('huggingface.co'); // routed through the HF DownloadProvider
});
