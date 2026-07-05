import type { ToolSet } from 'ai';
import type { Agent } from '../src/core/agent-def.ts';
import { createFileQaAgent } from './file-qa.ts';
import { createVisionAgent } from './vision.ts';
import { createWebFetchAgent } from './web-fetch.ts';
// AGENT-BUILDER:IMPORTS (generated agent imports are inserted above this line — do not remove)

/** A specialist is a factory taking its (MCP-scoped) tool set and returning an Agent. */
export type AgentFactory = (tools: ToolSet) => Agent;

/** The registry of available specialists, keyed by Agent.name (snake_case).
 *  Insertion order is the orchestrator's routing-catalog order. */
export const AGENTS: Record<string, AgentFactory> = {
  file_qa: createFileQaAgent,
  web_fetch: createWebFetchAgent,
  vision: createVisionAgent,
  // AGENT-BUILDER:ENTRIES (generated agent entries are inserted above this line — do not remove)
};

export function agentNames(): string[] {
  return Object.keys(AGENTS);
}
