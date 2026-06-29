import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { createOrchestrator } from '../src/core/orchestrator.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import { createFileQaAgent } from './file-qa.ts';
import { createWebFetchAgent } from './web-fetch.ts';

const BASE_PROMPT =
  'You are an orchestrator. You do not perform tasks yourself; you route them to specialized agents.';

/** Build the super-agent (orchestrator) with file-Q&A and web-fetch registered. */
export function createSuperAgent(
  fileQaTools: ToolSet,
  fetchTools: ToolSet,
): Agent {
  const fileQa = createFileQaAgent(fileQaTools);
  const webFetch = createWebFetchAgent(fetchTools);
  return createOrchestrator({
    name: 'super',
    model: createOllamaModel(qwenFast),
    systemPrompt: BASE_PROMPT,
    agents: [fileQa, webFetch],
  });
}
