import { describe, expect, it } from 'bun:test';
import { fitAndRank } from '../../src/provisioning/fit.ts';
import { ProviderKind } from '../../src/core/types.ts';

const cand = (model: string, params: number, size: number) => ({
  provider: ProviderKind.Ollama, model, params: {}, role: 'x',
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.6 },
  repo: model, fileSizeBytes: size, downloads: 100, installed: false,
});

describe('fitAndRank', () => {
  it('drops candidates that do not fit the budget', () => {
    const out = fitAndRank([cand('big', 70, 40e9), cand('small', 4, 3e9)], 8e9);
    expect(out.every((c) => c.fits)).toBe(true);
    expect(out.map((c) => c.model)).toEqual(['small']);
  });
  it('ranks larger-that-fits first', () => {
    const out = fitAndRank([cand('a', 4, 3e9), cand('b', 7, 5e9)], 8e9);
    expect(out.map((c) => c.model)).toEqual(['b', 'a']);
  });
  it('marks the top fitting model per runtime as recommended', () => {
    const out = fitAndRank([cand('a', 4, 3e9), cand('b', 7, 5e9)], 8e9);
    expect(out.find((c) => c.model === 'b')?.recommended).toBe(true);
    expect(out.find((c) => c.model === 'a')?.recommended).toBe(false);
  });
  it('never recommends a lone 0-params/0-size placeholder candidate', () => {
    const out = fitAndRank([cand('placeholder', 0, 0)], 1e12);
    expect(out.map((c) => c.model)).toEqual(['placeholder']);
    expect(out.find((c) => c.model === 'placeholder')?.recommended).toBe(false);
  });
  it('recommends the real candidate over a 0/0 placeholder for the same provider', () => {
    const out = fitAndRank(
      [cand('placeholder', 0, 0), cand('real', 7, 5e9)],
      8e9,
    );
    expect(out.find((c) => c.model === 'real')?.recommended).toBe(true);
    expect(out.find((c) => c.model === 'placeholder')?.recommended).toBe(false);
  });
});
