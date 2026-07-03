import { describe, expect, it } from 'bun:test';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { runProvision } from '../../src/provisioning/provisioner.ts';
import {
  DownloadPhase,
  type DownloadProgress,
} from '../../src/provisioning/types.ts';

const host = {
  totalRamBytes: 24e9,
  liveBudgetBytes: 8e9,
  runtimes: [RuntimeKind.Ollama],
};
const cand = (model: string, size: number) => ({
  runtime: RuntimeKind.Ollama,
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
  const barEvents: { render: DownloadProgress[]; done: DownloadProgress[] } = {
    render: [],
    done: [],
  };
  return {
    downloaded,
    barEvents,
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
          phase: DownloadPhase.Downloading,
          bytesCompleted: 1e9,
          bytesTotal: 3e9,
          percent: 33,
          speedBytesPerSec: 1,
        });
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
      bar: {
        render(p: DownloadProgress) {
          barEvents.render.push(p);
        },
        done(p: DownloadProgress) {
          barEvents.done.push(p);
        },
      },
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

  it('calls bar.done() on the terminal Done event, bar.render() for intermediate events', async () => {
    const d = deps();
    await runProvision({ deps: d, autoYes: false });
    expect(d.barEvents.render).toHaveLength(1);
    expect(d.barEvents.render[0]?.phase).toBe(DownloadPhase.Downloading);
    expect(d.barEvents.done).toHaveLength(1);
    expect(d.barEvents.done[0]?.phase).toBe(DownloadPhase.Done);
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

  it('passes a non-empty destDir to the download provider', async () => {
    let seenDestDir: string | undefined;
    const d = deps({
      providerFor: () => ({
        kind: ProviderKind.Ollama,
        download: async (m: string, o: any) => {
          seenDestDir = o.destDir;
        },
      }),
    });
    await runProvision({ deps: d, autoYes: false });
    expect(typeof seenDestDir).toBe('string');
    expect(seenDestDir!.length).toBeGreaterThan(0);
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
