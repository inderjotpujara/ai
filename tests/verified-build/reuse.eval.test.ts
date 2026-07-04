/**
 * In-repo reuse calibration eval — guards the BAND LOGIC of reuseDecision
 * (duplicate >= 0.85 -> Reuse, related 0.75–0.85 -> Offer, distinct < 0.75 ->
 * Generate, per reuseBands() defaults), NOT the absolute cosine numbers a
 * real local embedder produces.
 *
 * The embedder here is a deterministic fake: each labeled signature text is
 * assigned a hand-picked unit vector [cos, sin] whose cosine against the
 * single manifest anchor vector [1, 0] is the labeled similarity. That keeps
 * the eval hermetic (no Ollama) and lets every case land in an intended band.
 *
 * LIVE RECALIBRATION REQUIRED before trusting the absolute thresholds: local
 * embedders (e.g. qwen3-embedding:0.6b via Ollama) compress the cosine range
 * — unrelated texts routinely score 0.5–0.7 and true near-duplicates can sit
 * below 0.85 — so the 0.85/0.75 defaults in src/verified-build/config.ts must
 * be validated against the REAL embedder on a labeled corpus (tunable via
 * AGENT_REUSE_REUSE / AGENT_REUSE_OFFER, no code change needed). Nothing in
 * this hermetic run showed the band LOGIC itself to be wrong, so the config
 * defaults are left untouched.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reuseBands } from '../../src/verified-build/config.ts';
import { upsertEntry } from '../../src/verified-build/manifest.ts';
import { reuseDecision } from '../../src/verified-build/reuse.ts';
import { signatureText } from '../../src/verified-build/signature.ts';
import type {
  CapabilitySignature,
  ManifestEntry,
} from '../../src/verified-build/types.ts';
import { ReuseKind, VerifiedLevel } from '../../src/verified-build/types.ts';

enum Relationship {
  Duplicate = 'duplicate',
  Related = 'related',
  Distinct = 'distinct',
}

const EXPECTED_KIND: Record<Relationship, ReuseKind> = {
  [Relationship.Duplicate]: ReuseKind.Reuse,
  [Relationship.Related]: ReuseKind.Offer,
  [Relationship.Distinct]: ReuseKind.Generate,
};

function sigFor(purpose: string): CapabilitySignature {
  return { purpose, tools: [], modelTier: '', io: '', roles: [] };
}

/** Unit vector at the given cosine against the anchor [1, 0]. */
function vecFor(cos: number): number[] {
  return [cos, Math.sqrt(1 - cos * cos)];
}

/** Labeled set: signature texts paired with the anchor need "summarize web
 *  pages", each with an intended similarity and expected relationship.
 *  Boundary cases sit just off 0.85 / 0.75 (not exactly on them) so float
 *  noise in the cosine cannot flip a band. */
const CASES: { purpose: string; cos: number; relationship: Relationship }[] = [
  // duplicates — same capability, reworded
  {
    purpose: 'summarize the content of a web page',
    cos: 0.97,
    relationship: Relationship.Duplicate,
  },
  {
    purpose: 'fetch a url and summarize it',
    cos: 0.86,
    relationship: Relationship.Duplicate,
  },
  // related — overlapping capability, different medium or extra requirement
  {
    purpose: 'summarize web pages with source citations',
    cos: 0.849,
    relationship: Relationship.Related,
  },
  {
    purpose: 'summarize a pdf document',
    cos: 0.8,
    relationship: Relationship.Related,
  },
  {
    purpose: 'extract key points from an article',
    cos: 0.76,
    relationship: Relationship.Related,
  },
  // distinct — different capability entirely
  {
    purpose: 'monitor rss feeds for changes',
    cos: 0.749,
    relationship: Relationship.Distinct,
  },
  {
    purpose: 'triage github issues by severity',
    cos: 0.6,
    relationship: Relationship.Distinct,
  },
  {
    purpose: 'convert csv files to json',
    cos: 0.3,
    relationship: Relationship.Distinct,
  },
];

/** Deterministic fake embedder: fixed vector table keyed by signature text. */
const VECTORS = new Map(
  CASES.map((c) => [signatureText(sigFor(c.purpose)), vecFor(c.cos)]),
);

const embed = async (texts: string[]): Promise<number[][]> =>
  texts.map((t) => {
    const v = VECTORS.get(t);
    if (v === undefined) throw new Error(`no labeled vector for: ${t}`);
    return v;
  });

function anchorEntry(): ManifestEntry {
  return {
    need: 'summarize web pages',
    signature: sigFor('summarize web pages'),
    vector: [1, 0],
    verifiedLevel: VerifiedLevel.Behaves,
    goldenPath: 'goldens/x.json',
    createdAtMs: 1,
    lastUsedMs: 2,
    useCount: 3,
    lastEvalPass: true,
  };
}

describe('reuse eval — threshold calibration against a labeled set', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vb-reuse-eval-'));
    upsertEntry(dir, 'web_summarizer', anchorEntry());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('the labeled bands match the shipped defaults (0.85 / 0.75)', () => {
    // If someone retunes config.ts (or the env), this eval's labels are stale
    // and every case below must be re-banded — fail loudly here first.
    expect(reuseBands()).toEqual({ reuse: 0.85, offer: 0.75 });
  });

  for (const c of CASES) {
    test(`${c.relationship}: "${c.purpose}" (cos ${c.cos}) -> ${EXPECTED_KIND[c.relationship]}`, async () => {
      const decision = await reuseDecision(sigFor(c.purpose), { embed, dir });
      expect(decision.kind).toBe(EXPECTED_KIND[c.relationship]);
      expect(decision.similarity).toBeCloseTo(c.cos, 5);
      // Any non-empty manifest names its best match, whatever the band.
      expect(decision.match).toBe('web_summarizer');
    });
  }

  test('would fail if bands regressed to always-Reuse or always-Generate', async () => {
    // Regression guard mirroring the provisioning eval: the SAME embedder and
    // manifest must produce all three kinds across the labeled set — a
    // collapsed band function cannot pass this.
    const kinds = new Set<ReuseKind>();
    for (const c of CASES) {
      const decision = await reuseDecision(sigFor(c.purpose), { embed, dir });
      kinds.add(decision.kind);
    }
    expect(kinds).toEqual(
      new Set([ReuseKind.Reuse, ReuseKind.Offer, ReuseKind.Generate]),
    );
  });
});
