import type { z } from 'zod';
import type { Agent } from '../core/agent-def.ts';
import type { ModelRequirement } from '../core/types.ts';
import type { VerifiedLevel } from '../verified-build/types.ts';
import type { WritePaths } from './write.ts';

/** A curated-pack MCP server the generated agent needs, scoped to that agent. */
export type SuggestedServer = { packName: string; scopeToAgent: string };

/** A drafted specialist agent: definition + the minimal scoped tools it needs. */
export type AgentProposal = {
  name: string; // snake_case, unique vs the registry
  description: string; // the orchestrator routes on this
  systemPrompt: string;
  modelReq: ModelRequirement;
  suggestedServers: SuggestedServer[]; // pack-only, each scoped to `name`
  rationale: string; // why this agent + these tools (shown to the user)
};

export type ValidationIssue = { field: string; problem: string };

export type BuildResult =
  | {
      kind: 'written';
      proposal: AgentProposal;
      files: string[];
      level?: VerifiedLevel;
    }
  | { kind: 'declined' }
  | { kind: 'invalid'; issues: ValidationIssue[] }
  | { kind: 'abandoned'; reason: string }
  /** Reuse-check hit an existing agent close enough in capability — nothing
   *  was generated. */
  | { kind: 'reused'; name: string; similarity: number }
  /** Consent was granted and the proposal was staged, but it failed the
   *  verify-then-commit gate (structural / dry-run / golden-eval) and
   *  `deps.verify.force` was not set — nothing was registered. */
  | { kind: 'failed-verification'; stage: string; detail: string };

/** Structured-generation seam so the pure units never import the AI SDK.
 *  The real impl (deps.ts) wraps `generateObject` with a live model. */
export type BuilderModel = {
  object: <T>(args: { schema: z.ZodType<T>; prompt: string }) => Promise<T>;
  /** Plain-text generation (think-first stages that must NOT be JSON-constrained). */
  text: (args: { prompt: string }) => Promise<string>;
};

/** Optional verify-then-commit bundle. Undefined ⇒ `buildAgent` keeps the OLD
 *  behavior (write straight to the registry on consent, `{kind:'written'}`
 *  with `level` omitted) — every existing caller/test is unaffected. Present
 *  ⇒ `buildAgent` runs reuse-check → generate → consent → stage → verify →
 *  commit (see `src/verified-build/gate.ts`). */
export type BuilderVerifyDeps = {
  embed: (t: string[]) => Promise<number[][]>;
  judgeCandidates: () => { model: string; params: number; family: string }[];
  /** Wraps `runGuardedAgent` — runs a (not-yet-registered) agent def against one task. */
  runAgent: (
    agent: Agent,
    task: string,
  ) => Promise<{ text: string } | { error: string }>;
  /** One yes/no judge call for a single rubric prompt. */
  judge: (prompt: string) => Promise<boolean>;
  generatorFamily?: string;
  /** Agents dir the manifest/golden sidecar files live under. */
  dir: string;
  /** Downgrade a failing gate to an Unverified commit instead of aborting. */
  force?: boolean;
};

export type BuilderDeps = {
  model: BuilderModel;
  existingNames: () => string[];
  packNames: () => string[];
  confirm: (proposalText: string) => Promise<boolean>;
  paths: WritePaths;
  log?: (m: string) => void;
  verify?: BuilderVerifyDeps;
};

/** A drafted brand-new tool module (Task 24, discharges the Slice-17
 *  "no tool-code generation" deferral). `code` is model-authored — the FULL
 *  proposed TS module text — so unlike `AgentProposal.systemPrompt` (plain
 *  text embedded as data) this really is generated code. The safety trade is
 *  structural: it is written to disk as a review artifact only (write-tool.ts),
 *  gated behind the same mandatory consent as agents, and NEVER imported,
 *  eval'd, or wired into any agent's toolset in the same run — a human reviews
 *  the file and activates it deliberately, in a later, separate step. */
export type ToolProposal = {
  name: string; // snake_case unique tool module id, e.g. word_count
  description: string; // one sentence: what the tool does
  code: string; // full generated TS module source — PROPOSAL, never executed here
  rationale: string; // why this tool is needed
};

export type ToolBuildResult =
  | { kind: 'written'; proposal: ToolProposal; file: string }
  | { kind: 'declined' }
  | { kind: 'invalid'; issues: ValidationIssue[] };

export type ToolBuilderDeps = {
  model: BuilderModel;
  existingModuleNames: () => string[];
  confirm: (proposalText: string) => Promise<boolean>;
  /** Directory the reviewable `<name>.proposal.ts` file is written into.
   *  Deliberately NOT `agents/` or any registry/index location — nothing in
   *  this process reads this directory back, so writing here can never
   *  amount to same-run activation. */
  proposalsDir: string;
  log?: (m: string) => void;
};
