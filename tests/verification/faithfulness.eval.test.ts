import { describe, expect, test } from 'bun:test';
import type { RetrievalResult } from '../../src/memory/types.ts';
import type { VerifyDeps } from '../../src/verification/types.ts';
import { verify } from '../../src/verification/verify.ts';
import golden from './golden/cases.json';

/**
 * In-repo faithfulness eval gate (Slice 13 / Task 11).
 *
 * Runs the REAL `verify()` pipeline (decompose -> getByIds -> per-claim judge
 * -> aggregation) over a golden set, but with a deterministic, offline
 * stand-in `VerifyDeps` so the gate is hermetic (no Ollama / network calls).
 * The stand-in plays two roles depending on which prompt `verify()` sends:
 *
 *  1. Claim decomposition prompt (contains "atomic factual claims"): split
 *     the answer into sentence-level claims and attach only the [mem:id]
 *     citations that appear within that sentence. This is a faithful,
 *     deterministic re-implementation of what a real LLM decomposer should
 *     do for these single/double-sentence golden answers — it genuinely
 *     exercises decomposeClaims' JSON-parsing path in verify.ts.
 *
 *  2. Per-claim judge prompt (the "Document:\n...\n\nClaim: ..." shape from
 *     judge.ts#checkClaim): a lexical-entailment heuristic — Yes if a large
 *     majority of the claim's significant (non-stopword) content words
 *     appear in the cited evidence document, else No. This stands in for
 *     MiniCheck (Task 12 adds a `.live` variant using the real judge).
 */

type GoldenCase = {
  id: string;
  answer: string;
  evidence: { id: string; text: string }[];
  expectedSupported: boolean;
};

const cases = golden as GoldenCase[];

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'as',
  'and',
  'or',
  'but',
  'it',
  'its',
  'that',
  'this',
  'these',
  'those',
  'from',
  'into',
  'has',
  'have',
  'had',
  'using',
  'used',
  'use',
  'known',
]);

/** Crude suffix-stripping stemmer — just enough to fold "converts"/"convert",
 * "uses"/"using", "stored"/"storing" together without pulling in a real NLP
 * dependency. Good enough for this offline lexical stand-in. */
function stem(word: string): string {
  return word
    .replace(/(ing|ies|ed|es|s)$/, (suffix) => (suffix === 'ies' ? 'y' : ''))
    .replace(/^(.{3,})y$/, '$1');
}

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[mem:[^\]]+\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);
}

/** Splits an answer into sentence-level claims, each keeping only the
 * [mem:id] citations that literally appear within that sentence's span. */
function splitIntoClaims(
  answer: string,
): { text: string; citedIds: string[] }[] {
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.map((sentence) => {
    const citedIds: string[] = [];
    const re = /\[mem:([^\]]+)\]/g;
    let m = re.exec(sentence);
    while (m !== null) {
      const id = m[1]?.trim();
      if (id && !citedIds.includes(id)) citedIds.push(id);
      m = re.exec(sentence);
    }
    const text = sentence.replace(/\s*\[mem:[^\]]+\]/g, '').trim();
    return { text, citedIds };
  });
}

/** Lexical-entailment stand-in judge: Yes if most of the claim's content
 * words are present in the evidence document AND every number the claim
 * states also appears in the document, else No. The numeric check catches
 * the common hallucination shape of swapping a date/quantity while keeping
 * the surrounding prose lexically close to the source. Deterministic. */
function lexicalJudge(claim: string, document: string): 'Yes' | 'No' {
  const claimWords = contentWords(claim);
  if (claimWords.length === 0) return 'No';
  const docWords = new Set(contentWords(document));
  const overlap = claimWords.filter((w) => docWords.has(w)).length;
  const ratio = overlap / claimWords.length;

  const claimNumbers = claim.match(/\d+/g) ?? [];
  const docNumberSet = new Set(document.match(/\d+/g) ?? []);
  const allNumbersMatch = claimNumbers.every((n) => docNumberSet.has(n));

  return ratio >= 0.75 && allNumbersMatch ? 'Yes' : 'No';
}

function buildDeps(activeCase: GoldenCase): VerifyDeps {
  const evidenceById = new Map(activeCase.evidence.map((e) => [e.id, e.text]));
  return {
    generalModel: 'stand-in-general',
    ensureJudge: async () => ({ model: 'stand-in', fallback: true }),
    getByIds: async (
      _space: string,
      ids: string[],
    ): Promise<RetrievalResult[]> =>
      ids
        .filter((id) => evidenceById.has(id))
        .map((id) => ({
          id,
          text: evidenceById.get(id) ?? '',
          source: 'golden',
          score: 1,
          namespace: 'golden',
        })),
    generate: async (_model: string, prompt: string): Promise<string> => {
      if (prompt.includes('atomic factual claims')) {
        const answerMatch = prompt.match(/ANSWER:\n([\s\S]*)$/);
        const answer = answerMatch?.[1] ?? '';
        const claims = splitIntoClaims(answer);
        return JSON.stringify(claims);
      }
      // Judge prompt shape from judge.ts#checkClaim:
      // "Document:\n<evidence>\n\nClaim: <claim>\n\n..."
      const docMatch = prompt.match(/Document:\n([\s\S]*?)\n\nClaim: /);
      const claimMatch = prompt.match(/Claim: ([\s\S]*?)\n\n/);
      const document = docMatch?.[1] ?? '';
      const claim = claimMatch?.[1] ?? '';
      return lexicalJudge(claim, document);
    },
  };
}

type CaseResult = {
  id: string;
  expectedSupported: boolean;
  actualSupported: boolean;
};

describe('faithfulness golden-set eval (offline stand-in judge)', () => {
  test('every golden case has evidence ids matching its evidence array (fixture sanity)', () => {
    for (const c of cases) {
      const ids = new Set(c.evidence.map((e) => e.id));
      expect(ids.size).toBe(c.evidence.length);
    }
  });

  test('golden set: verify() detection quality vs expectedSupported', async () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.length).toBeLessThanOrEqual(20);

    const results: CaseResult[] = [];
    for (const c of cases) {
      const verdict = await verify(
        c.answer,
        { query: c.id, space: 'golden' },
        buildDeps(c),
      );
      results.push({
        id: c.id,
        expectedSupported: c.expectedSupported,
        actualSupported: verdict.supported,
      });
    }

    const expectedFail = results.filter((r) => !r.expectedSupported);
    const expectedPass = results.filter((r) => r.expectedSupported);
    expect(expectedFail.length).toBeGreaterThan(0);
    expect(expectedPass.length).toBeGreaterThan(0);

    // Recall of failures: every planted hallucination / uncited / no-evidence
    // case MUST be flagged unsupported by the real pipeline. This is the
    // safety-critical direction — missing a hallucination is the failure
    // mode the gate exists to catch.
    const missedHallucinations = expectedFail.filter((r) => r.actualSupported);
    expect(
      missedHallucinations.map((r) => r.id),
      `expected these to be flagged unsupported but verify() said supported: ${missedHallucinations.map((r) => r.id).join(', ')}`,
    ).toEqual([]);
    const failRecall =
      (expectedFail.length - missedHallucinations.length) / expectedFail.length;
    expect(failRecall).toBe(1);

    // False-abstention bound: grounded answers wrongly flagged unsupported
    // must stay small (the lexical stand-in is coarser than a real judge, so
    // we allow a little slack, not zero).
    const falseAbstentions = expectedPass.filter((r) => !r.actualSupported);
    expect(
      falseAbstentions.map((r) => r.id),
      `expected these grounded cases to pass but verify() said unsupported: ${falseAbstentions.map((r) => r.id).join(', ')}`,
    ).toEqual([]);
    expect(falseAbstentions.length).toBeLessThanOrEqual(1);

    // Precision on the "unsupported" call: of everything the pipeline
    // flagged unsupported, how much was truly a bad case (not a wrongly
    // flagged grounded one). With 0 false abstentions this is 1.0.
    const flaggedUnsupported = results.filter((r) => !r.actualSupported);
    const truePositives = flaggedUnsupported.filter(
      (r) => !r.expectedSupported,
    ).length;
    const precision = truePositives / (flaggedUnsupported.length || 1);
    expect(precision).toBeGreaterThanOrEqual(0.95);
  });

  test('category coverage: golden set spans grounded, hallucination, uncited, and no-evidence cases', () => {
    const byPrefix = (prefix: string) =>
      cases.filter((c) => c.id.startsWith(prefix));
    expect(byPrefix('grounded-').length).toBeGreaterThanOrEqual(3);
    expect(byPrefix('hallucination-').length).toBeGreaterThanOrEqual(3);
    expect(byPrefix('uncited-').length).toBeGreaterThanOrEqual(2);
    expect(byPrefix('no-evidence-').length).toBeGreaterThanOrEqual(2);
  });
});
