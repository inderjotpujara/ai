import { describe, expect, it } from 'bun:test';
import { ProviderKind } from '../../src/core/types.ts';
import { detectMissing } from '../../src/provisioning/detect-missing.ts';

const decl = (model: string) => ({
  provider: ProviderKind.Ollama,
  model,
  params: {},
  role: 'x',
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.6 },
});

describe('detectMissing', () => {
  it('returns only the declared models that are not installed', async () => {
    const installed = new Set(['a']);
    const out = await detectMissing([decl('a'), decl('b')], async (m) =>
      installed.has(m),
    );
    expect(out.map((d) => d.model)).toEqual(['b']);
  });
});
