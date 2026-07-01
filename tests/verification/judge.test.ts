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

/** Judges only the claim line, ignoring incidental word overlap in the
 * (possibly larger, pooled) evidence document — mirrors a real entailment
 * judge caring about the CLAIM's own assertion, not stray shared words. */
const claimAware: VerifyDeps = {
  generalModel: 'g',
  generate: async (_m: string, p: string) => {
    const claim = p.match(/Claim: ([\s\S]*?)\n\n/)?.[1] ?? '';
    return claim.includes('blue') ? 'Yes' : 'No';
  },
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
  test('verifyFaithfulness judges every claim against the pooled evidence (not per-claim citedIds)', async () => {
    // citedIds on individual claims are no longer trusted for judging — only
    // the pooled evidence (built from the answer's own parsed citations)
    // matters. A claim entailed by the pool is supported even if its own
    // (LLM-extracted) citedIds are wrong/empty/prefixed.
    const claims = [
      { text: 'sky is blue', citedIds: ['mem:a#0'] }, // wrong-prefixed id, ignored
      { text: 'grass is purple', citedIds: [] }, // contradicts pool
    ];
    const ev = new Map([
      ['a#0', 'the sky is blue'],
      ['b#0', 'grass is green'],
    ]);
    const v = await verifyFaithfulness(claims, ev, 'j', false, 0.9, claimAware);
    expect(v.claims.find((c) => c.claim === 'sky is blue')?.supported).toBe(
      true,
    );
    expect(v.claims.find((c) => c.claim === 'grass is purple')?.supported).toBe(
      false,
    );
    expect(v.faithfulness).toBeCloseTo(1 / 2, 5);
    expect(v.supported).toBe(false);
    expect(v.unsupportedClaims).toContain('grass is purple');
  });

  test('verifyFaithfulness: empty pool → every claim unsupported (no citation)', async () => {
    const claims = [{ text: 'sky is blue', citedIds: ['a#0'] }];
    const v = await verifyFaithfulness(claims, new Map(), 'j', false, 0.9, yes);
    expect(v.supported).toBe(false);
    expect(v.faithfulness).toBe(0);
    expect(v.claims[0]?.reason).toBe('no citation');
    expect(v.unsupportedClaims).toContain('sky is blue');
  });
});
