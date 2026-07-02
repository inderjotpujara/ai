import type { ToolSet } from 'ai';
import qwenRouter from '../models/qwen-router.ts';
import type { Agent } from '../src/core/agent-def.ts';
import type { BeforeDelegate } from '../src/core/delegate.ts';
import { createOrchestrator } from '../src/core/orchestrator.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import { AGENTS, agentNames } from './index.ts';

const BASE_PROMPT =
  'You are an orchestrator. You do not perform tasks yourself; you route them to specialized agents.';

/** Build the super-agent (orchestrator) with every registered specialist.
 *  `toolsFor(name)` supplies each agent's MCP-scoped tool set (reg.forAgent). */
export function createSuperAgent(
  toolsFor: (name: string) => ToolSet,
  onBeforeDelegate?: BeforeDelegate,
): Agent {
  const agents: Agent[] = agentNames().map((name) => {
    const factory = AGENTS[name];
    if (!factory) throw new Error(`unknown agent: ${name}`);
    return factory(toolsFor(name));
  });
  return createOrchestrator({
    name: 'super',
    model: createOllamaModel(qwenRouter),
    systemPrompt: BASE_PROMPT,
    agents,
    onBeforeDelegate,
  });
}
