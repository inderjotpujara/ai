import { describe, expect, it } from 'bun:test';
import { ProviderKind, RuntimeKind } from '../../src/core/types.ts';
import { bytesPerWeightForQuant } from '../../src/discovery/quant.ts';
import { fitAndRank } from '../../src/provisioning/fit.ts';
import { gpuBudgetBytes } from '../../src/resource/hardware.ts';

const cand = (model: string, params: number, size: number) => ({
  runtime: RuntimeKind.Ollama,
  provider: ProviderKind.Ollama,
  model,
  params: {},
  role: 'x',
  footprint: { approxParamsBillions: params, bytesPerWeight: 0.6 },
  repo: model,
  fileSizeBytes: size,
  downloads: 100,
  installed: false,
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

  it('flows the tuned ~0.6 bytes-per-weight for Q4_K_M-class quants into the size estimate', () => {
    const bpw = bytesPerWeightForQuant('Q4_K_M');
    expect(bpw).toBeCloseTo(0.6, 2); // was 0.56 pre-tuning (Task 16)
    const candidate = {
      ...cand('q4km', 7, 0),
      footprint: { approxParamsBillions: 7, bytesPerWeight: bpw },
    };
    const out = fitAndRank([candidate], 100e9).find((c) => c.model === 'q4km');
    // weights = 7e9 * bpw * 1.2 (RUNTIME_OVERHEAD); kv = 8192 * 131072 (fit's fixed sizing context).
    const expectedWeights = 7e9 * bpw * 1.2;
    const expectedKv = 8192 * 131072;
    expect(out?.estimatedBytes).toBeCloseTo(expectedWeights + expectedKv, 0);
  });
});

describe('injectable Metal working-set reader (gpuBudgetBytes)', () => {
  it('uses the injected live reader when it returns a value', () => {
    const budget = gpuBudgetBytes(16e9, {
      readMetalWorkingSetBytes: () => 12e9,
    });
    expect(budget).toBe(12e9);
  });

  it('falls back to the static tier-fraction heuristic when the reader returns undefined (never throws)', () => {
    const budget = gpuBudgetBytes(16e9, {
      readMetalWorkingSetBytes: () => undefined,
    });
    expect(budget).toBe(Math.floor(16e9 * 0.75));
    expect(budget).toBeGreaterThan(0);
  });
});
