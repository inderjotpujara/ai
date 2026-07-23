import type { RuntimeKind } from '../core/types.ts';

export enum VerifiedLevel {
  Behaves = 'behaves',
  Runs = 'runs',
  Unverified = 'unverified',
}

export enum ReuseKind {
  Reuse = 'reuse',
  Offer = 'offer',
  Generate = 'generate',
}

export enum GoldenKind {
  TaskSuccess = 'task-success',
  Grounded = 'grounded',
  Routing = 'routing',
}

export enum ArtifactKind {
  Agent = 'agent',
  Crew = 'crew',
  Workflow = 'workflow',
}

export type CapabilitySignature = {
  purpose: string;
  tools: string[];
  modelTier: string;
  io: string;
  roles: string[];
};

export type GoldenCase = {
  id: string;
  input: string;
  assert: string;
  kind: GoldenKind;
};

export type GoldenSet = {
  need: string;
  cases: GoldenCase[];
};

export type DryRunResult = {
  ran: boolean;
  output?: string;
  error?: string;
  repairs: number;
};

export type EvalCaseResult = {
  id: string;
  passed: boolean;
  detail: string;
};

export type EvalResult = {
  passed: boolean;
  total: number;
  passedCount: number;
  perCase: EvalCaseResult[];
  judgeModel: string;
  belowBar: boolean;
};

export type ReuseDecision = {
  kind: ReuseKind;
  match?: string;
  similarity: number;
};

/** Model identity captured at the moment an eval last passed (Slice 32
 *  self-improvement baseline). Absent on pre-Slice-32 entries and on any
 *  entry rebuilt offline (`rebuildFromArtifacts`), since no live resolve ran. */
export type VerifiedWith = {
  runtime: RuntimeKind;
  model: string;
  paramsBillions: number;
  numCtx: number;
  /** Best-effort, parsed from the model tag (R2); undefined when not derivable. */
  quant?: string;
  capturedAtMs: number;
};

export type ManifestEntry = {
  need: string;
  signature: CapabilitySignature;
  vector: number[];
  verifiedLevel: VerifiedLevel;
  goldenPath: string;
  createdAtMs: number;
  lastUsedMs: number;
  useCount: number;
  lastEvalPass: boolean;
  /** Model identity this entry last verified against; undefined = no baseline
   *  captured yet (pre-Slice-32 entry or offline rebuild). */
  verifiedWith?: VerifiedWith;
};

export type Manifest = {
  version: number;
  entries: Record<string, ManifestEntry>;
};

export type VerificationResult =
  | {
      kind: 'committed';
      name: string;
      level: VerifiedLevel;
      dryRun: DryRunResult;
      eval?: EvalResult;
    }
  | { kind: 'reused'; name: string; similarity: number }
  | {
      kind: 'failed';
      stage: 'structural' | 'dry-run' | 'golden-eval';
      detail: string;
    };
