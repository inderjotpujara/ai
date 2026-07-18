import { VOICE_MODEL_TIERS } from '@contracts';
import { describe, expect, it } from 'vitest';
import { ModelTier } from './model-tier.ts';

describe('ModelTier parity with the isomorphic contract mirror', () => {
  it('matches VOICE_MODEL_TIERS (src/contracts/telemetry.ts) exactly — a tier added on one side without the other must fail loudly', () => {
    const webValues = Object.values(ModelTier).slice().sort();
    const contractValues = [...VOICE_MODEL_TIERS].sort();
    expect(webValues).toEqual(contractValues);
  });
});
