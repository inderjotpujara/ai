import type { RetrievalResult } from '../memory/types.ts';

export enum CragGrade { Correct = 'correct', Ambiguous = 'ambiguous', Incorrect = 'incorrect' }

export type Claim = { text: string; citedIds: string[] };
export type ClaimVerdict = { claim: string; citedIds: string[]; supported: boolean; reason?: string };
export type Verdict = {
  supported: boolean;
  faithfulness: number;        // 0..1 = supported / total claims
  claims: ClaimVerdict[];
  unsupportedClaims: string[];
  usedFallback: boolean;
};

export type VerifyOptions = { space?: string; threshold?: number };

/** Injected so the primitive stays pure/testable. Real wiring lives in the CLI. */
export type VerifyDeps = {
  /** Run a prompt on a model id, return its text. Real impl routes via the Model Manager. */
  generate: (model: string, prompt: string) => Promise<string>;
  /** Fetch chunk texts by id from the memory store. */
  getByIds: (space: string, ids: string[]) => Promise<RetrievalResult[]>;
  /** Ensure the judge model is available; returns which model to use + whether it's the fallback. */
  ensureJudge: (model: string) => Promise<{ model: string; fallback: boolean }>;
  /** The general/router model id used for decomposition, grading, and fallback judging. */
  generalModel: string;
};
