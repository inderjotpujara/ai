import type { z } from 'zod';
import type { ModelRequirement } from '../core/types.ts';
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
  | { kind: 'written'; proposal: AgentProposal; files: string[] }
  | { kind: 'declined' }
  | { kind: 'invalid'; issues: ValidationIssue[] }
  | { kind: 'abandoned'; reason: string };

/** Structured-generation seam so the pure units never import the AI SDK.
 *  The real impl (deps.ts) wraps `generateObject` with a live model. */
export type BuilderModel = {
  object: <T>(args: { schema: z.ZodType<T>; prompt: string }) => Promise<T>;
  /** Plain-text generation (think-first stages that must NOT be JSON-constrained). */
  text: (args: { prompt: string }) => Promise<string>;
};

export type BuilderDeps = {
  model: BuilderModel;
  existingNames: () => string[];
  packNames: () => string[];
  confirm: (proposalText: string) => Promise<boolean>;
  paths: WritePaths;
  log?: (m: string) => void;
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
