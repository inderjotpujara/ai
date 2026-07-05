import type { ToolSet } from 'ai';
import qwenRouter from '../models/qwen-router.ts';
import type { Agent } from '../src/core/agent-def.ts';
import type { BeforeDelegate } from '../src/core/delegate.ts';
import { createOrchestrator } from '../src/core/orchestrator.ts';
import { createGenerateTools } from '../src/media/generate/tools.ts';
import type { MediaStore } from '../src/media/store.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import type { DegradationLedger } from '../src/reliability/ledger.ts';
import { AGENTS, agentNames } from './index.ts';

const BASE_PROMPT =
  'You are an orchestrator. You do not perform tasks yourself; you route them to specialized agents.';

/** Build the super-agent (orchestrator) with every registered specialist.
 *  `toolsFor(name)` supplies each agent's MCP-scoped tool set (reg.forAgent).
 *  `ledger`, when supplied, is forwarded to the orchestrator so a dropped
 *  sub-agent (or a tripped circuit) during delegation is recorded.
 *  `mediaStore`, when supplied, is forwarded so specialists can resolve
 *  `[img:h]`/`[video:h]` markers attached to a chat's media flags. */
export function createSuperAgent(
  toolsFor: (name: string) => ToolSet,
  onBeforeDelegate?: BeforeDelegate,
  ledger?: DegradationLedger,
  mediaStore?: MediaStore,
): Agent {
  const agents: Agent[] = agentNames().map((name) => {
    const factory = AGENTS[name];
    if (!factory) throw new Error(`unknown agent: ${name}`);
    const agent = factory(toolsFor(name));
    // The media_creator specialist needs the run-scoped generate tools to
    // actually produce files; every other agent keeps just its injected set.
    if (name === 'media_creator' && mediaStore) {
      return {
        ...agent,
        tools: { ...agent.tools, ...createGenerateTools(mediaStore) },
      };
    }
    return agent;
  });
  return createOrchestrator({
    name: 'super',
    model: createOllamaModel(qwenRouter),
    systemPrompt: BASE_PROMPT,
    agents,
    onBeforeDelegate,
    ledger,
    mediaStore,
  });
}
