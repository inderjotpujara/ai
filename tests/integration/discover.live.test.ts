import { describe, expect, test } from 'bun:test';

async function online(): Promise<boolean> {
  try {
    return (
      await fetch('https://huggingface.co/api/models?filter=gguf&limit=1', {
        signal: AbortSignal.timeout(3000),
      })
    ).ok;
  } catch {
    return false;
  }
}
const ready = await online();

describe.skipIf(!ready)('live HF discovery', () => {
  test('returns ≥1 tool-capable GGUF candidate that fits', async () => {
    const { runDiscovery } = await import('../../src/discovery/discover.ts');
    let written = 0;
    const r = await runDiscovery({
      host: {
        totalRamBytes: 24e9,
        liveBudgetBytes: 12e9,
        runtimes: [] as never[],
      },
      writeCatalog: (c) => {
        written = c.length;
      },
      pullTop: async () => {}, // don't actually pull multi-GB in a test
      prePullCount: 0,
    });
    expect(r.fits).toBeGreaterThan(0);
    expect(written).toBeGreaterThan(0);
  }, 60_000);
});
