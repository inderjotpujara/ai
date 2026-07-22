import type { ToolSet } from 'ai';
import qwenRouter from '../models/qwen-router.ts';
import type { Agent } from '../src/core/agent-def.ts';
import type { BeforeDelegate } from '../src/core/delegate.ts';
import type { EventSink } from '../src/core/events.ts';
import { createOrchestrator } from '../src/core/orchestrator.ts';
import { createGenerateTools } from '../src/media/generate/tools.ts';
import type { MediaStore } from '../src/media/store.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import type { DegradationLedger } from '../src/reliability/ledger.ts';
import { AGENTS, agentNames } from './index.ts';

const BASE_PROMPT = [
  'You are an orchestrator. You do not perform tasks yourself; you route them to specialized agents.',
  "If the user's request contains a media marker like [img:...], [audio:...], or [video:...], copy that marker VERBATIM into the task you pass to the specialist — never omit, rename, or paraphrase it; the specialist needs it to load the media.",
].join(' ');

/** Build the super-agent (orchestrator) with every registered specialist.
 *  `toolsFor(name)` supplies each agent's MCP-scoped tool set (reg.forAgent).
 *  `ledger`, when supplied, is forwarded to the orchestrator so a dropped
 *  sub-agent (or a tripped circuit) during delegation is recorded.
 *  `mediaStore`, when supplied, is forwarded so specialists can resolve
 *  `[img:h]`/`[video:h]` markers attached to a chat's media flags.
 *  `events`, when supplied, is forwarded so a future server can observe
 *  delegation without the engine importing wire types. */
export function createSuperAgent(
  toolsFor: (name: string) => ToolSet,
  onBeforeDelegate?: BeforeDelegate,
  ledger?: DegradationLedger,
  mediaStore?: MediaStore,
  events?: EventSink,
  /** Slice 31, Task 29b: pre-built `delegate_to_<name>` tools for mounted A2A
   *  remote peers (`mountRemotes`). Forwarded to the orchestrator so a remote
   *  is a delegate target alongside the local specialists. Empty/undefined ⇒
   *  no change. `onRemoteWarn` sinks the local-wins name-collision warning. */
  remoteTools?: ToolSet,
  onRemoteWarn?: (msg: string) => void,
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
    events,
    remoteTools,
    warn: onRemoteWarn,
  });
}
