import { describe, expect, test } from 'bun:test';
import {
  checkClaim,
  verifyFaithfulness,
} from '../../src/verification/judge.ts';
import type { VerifyDeps } from '../../src/verification/types.ts';

const yes: VerifyDeps = {
  generalModel: 'g',
  generate: async (_m: string, p: string) =>
    p.includes('blue') ? 'Yes' : 'No',
  getByIds: async () => [],
  ensureJudge: async (model: string) => ({ model, fallback: false }),
};

describe('judge', () => {
  test('checkClaim maps Yes/No → boolean', async () => {
    expect(await checkClaim('sky is blue', 'the sky is blue', 'j', yes)).toBe(
      true,
    );
    expect(await checkClaim('grass is red', 'grass is green', 'j', yes)).toBe(
      false,
    );
  });
  test('verifyFaithfulness aggregates + thresholds; uncited claim → unsupported', async () => {
    const claims = [
      { text: 'sky is blue', citedIds: ['a#0'] },
      { text: 'grass is red', citedIds: ['b#0'] },
      { text: 'uncited fact', citedIds: [] },
    ];
    const ev = new Map([
      ['a#0', 'the sky is blue'],
      ['b#0', 'grass is green'],
    ]);
    const v = await verifyFaithfulness(claims, ev, 'j', false, 0.9, yes);
    expect(v.claims.find((c) => c.claim === 'sky is blue')?.supported).toBe(
      true,
    );
    expect(v.claims.find((c) => c.claim === 'grass is red')?.supported).toBe(
      false,
    );
    expect(v.claims.find((c) => c.claim === 'uncited fact')?.supported).toBe(
      false,
    ); // no citation → unsupported
    expect(v.faithfulness).toBeCloseTo(1 / 3, 5);
    expect(v.supported).toBe(false);
    expect(v.unsupportedClaims).toContain('uncited fact');
  });
});
