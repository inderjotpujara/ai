import { describe, expect, it } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { runProvision } from '../../src/provisioning/provisioner.ts';
import { DownloadPhase } from '../../src/provisioning/types.ts';

const host = {
  totalRamBytes: 24e9,
  liveBudgetBytes: 8e9,
  runtimes: [ProviderKind.Ollama],
};
const cand = (model: string, size: number) => ({
  provider: ProviderKind.Ollama,
  model,
  params: {},
  role: 'x',
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 },
  repo: model,
  fileSizeBytes: size,
  downloads: 1,
  installed: false,
});

function deps(overrides = {}) {
  const downloaded: string[] = [];
  return {
    downloaded,
    detectHost: async () => host,
    catalogSources: [
      {
        name: 's',
        appliesTo: () => true,
        listCandidates: async () => [cand('qwen3.5:4b', 3e9)],
      },
    ],
    providerFor: () => ({
      kind: ProviderKind.Ollama,
      download: async (m: string, o: any) => {
        o.onProgress({
          modelRef: m,
          phase: DownloadPhase.Done,
          bytesCompleted: 3e9,
          bytesTotal: 3e9,
          percent: 100,
          speedBytesPerSec: 1,
        });
        downloaded.push(m);
      },
    }),
    enrichSize: async (c: any) => c.fileSizeBytes,
    freeDiskBytes: async () => 500e9,
    ui: {
      askYesNo: async () => true,
      selectModels: async (items: any[]) => items.filter((i) => i.recommended),
      bar: { render() {}, done() {} },
    },
    ...overrides,
  };
}

describe('runProvision', () => {
  it('downloads the consented recommended model', async () => {
    const d = deps();
    const res = await runProvision({ deps: d, autoYes: false });
    expect(res.downloaded).toEqual(['qwen3.5:4b']);
    expect(d.downloaded).toEqual(['qwen3.5:4b']);
  });

  it('records nothing downloaded when consent is declined', async () => {
    const res = await runProvision({
      deps: deps({
        ui: {
          askYesNo: async () => false,
          selectModels: async () => [],
          bar: { render() {}, done() {} },
        },
      }),
      autoYes: false,
    });
    expect(res.downloaded).toEqual([]);
  });

  it('degrades: a failing download is recorded in failed, others still proceed', async () => {
    const d = deps({
      catalogSources: [
        {
          name: 's',
          appliesTo: () => true,
          listCandidates: async () => [cand('good', 3e9), cand('bad', 3e9)],
        },
      ],
      providerFor: () => ({
        kind: ProviderKind.Ollama,
        download: async (m: string) => {
          if (m === 'bad') throw new Error('pull failed');
        },
      }),
      ui: {
        askYesNo: async () => true,
        selectModels: async (items: any[]) => items,
        bar: { render() {}, done() {} },
      },
    });
    const res = await runProvision({ deps: d, autoYes: false });
    expect(res.failed.map((f) => f.model)).toContain('bad');
    expect(res.downloaded).toContain('good');
  });
});
