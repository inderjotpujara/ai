import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertEntry } from '../../src/verified-build/manifest.ts';
import { reuseDecision } from '../../src/verified-build/reuse.ts';
import type {
  CapabilitySignature,
  ManifestEntry,
} from '../../src/verified-build/types.ts';
import { ReuseKind, VerifiedLevel } from '../../src/verified-build/types.ts';

const sig: CapabilitySignature = {
  purpose: 'summarize urls',
  tools: [],
  modelTier: '',
  io: '',
  roles: [],
};

/** Every embed call yields [1, 0] so entry vectors control the cosine. */
const embed = async (texts: string[]) => texts.map(() => [1, 0]);

function entry(vector: number[], useCount = 1): ManifestEntry {
  return {
    need: 'seed',
    signature: sig,
    vector,
    verifiedLevel: VerifiedLevel.Runs,
    goldenPath: 'goldens/x.json',
    createdAtMs: 1,
    lastUsedMs: 2,
    useCount,
    lastEvalPass: true,
  };
}

describe('reuseDecision', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vb-reuse-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('empty dir yields Generate with similarity 0 and no match', async () => {
    const decision = await reuseDecision(sig, { embed, dir });
    expect(decision).toEqual({ kind: ReuseKind.Generate, similarity: 0 });
  });

  test('identical vector (cosine 1.0) yields Reuse', async () => {
    upsertEntry(dir, 'twin', entry([1, 0]));
    const decision = await reuseDecision(sig, { embed, dir });
    expect(decision.kind).toBe(ReuseKind.Reuse);
    expect(decision.match).toBe('twin');
    expect(decision.similarity).toBeCloseTo(1.0);
  });

  test('cosine 0.8 lands in the offer band', async () => {
    upsertEntry(dir, 'near', entry([0.8, 0.6]));
    const decision = await reuseDecision(sig, { embed, dir });
    expect(decision.kind).toBe(ReuseKind.Offer);
    expect(decision.match).toBe('near');
    expect(decision.similarity).toBeCloseTo(0.8);
  });

  test('orthogonal vector (cosine 0) yields Generate with the match named', async () => {
    upsertEntry(dir, 'far', entry([0, 1]));
    const decision = await reuseDecision(sig, { embed, dir });
    expect(decision.kind).toBe(ReuseKind.Generate);
    expect(decision.match).toBe('far');
    expect(decision.similarity).toBeCloseTo(0);
  });

  test('picks the highest-similarity entry across several', async () => {
    upsertEntry(dir, 'far', entry([0, 1]));
    upsertEntry(dir, 'near', entry([0.8, 0.6]));
    upsertEntry(dir, 'twin', entry([1, 0]));
    const decision = await reuseDecision(sig, { embed, dir });
    expect(decision.kind).toBe(ReuseKind.Reuse);
    expect(decision.match).toBe('twin');
  });

  test('equal similarity tie-breaks by higher useCount', async () => {
    upsertEntry(dir, 'rarely_used', entry([1, 0], 1));
    upsertEntry(dir, 'well_used', entry([1, 0], 9));
    const decision = await reuseDecision(sig, { embed, dir });
    expect(decision.match).toBe('well_used');
  });
});
