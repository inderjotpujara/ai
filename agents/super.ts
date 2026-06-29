import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { createOrchestrator } from '../src/core/orchestrator.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';
import { createFileQaAgent } from './file-qa.ts';

const BASE_PROMPT =
  'You are an orchestrator. You do not perform tasks yourself; you route them to specialized agents.';

/** Build the super-agent (orchestrator) with the file-Q&A agent registered. */
export function createSuperAgent(fileQaTools: ToolSet): Agent {
  const fileQa = createFileQaAgent(fileQaTools);
  return createOrchestrator({
    name: 'super',
    model: createOllamaModel(qwenFast),
    systemPrompt: BASE_PROMPT,
    agents: [fileQa],
  });
}
