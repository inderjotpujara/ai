import type { LanguageModel, ToolSet } from 'ai';
import { runAgent } from './agent.ts';
import type { ModelDeclaration } from './types.ts';

/** A reusable agent: its own model + system prompt + tools, plus a routing description. */
export type Agent = {
  name: string; // stable id used in delegate tool names, e.g. 'file_qa'
  description: string; // capability description the orchestrator routes on
  model: LanguageModel;
  systemPrompt: string;
  tools: ToolSet;
  /** Declaration of the agent's model, for the resource manager (optional; mock agents omit it). */
  modelDecl?: ModelDeclaration;
};

/** Run an agent definition against a task. */
export function runDefinedAgent(
  agent: Agent,
  task: string,
): ReturnType<typeof runAgent> {
  return runAgent({
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    prompt: task,
    tools: agent.tools,
  });
}
