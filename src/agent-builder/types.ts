import type { ModelRequirement } from '../core/types.ts';

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
