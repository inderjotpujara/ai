import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { Capability, PreferPolicy } from '../src/core/types.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';

const SYSTEM_PROMPT =
  'You answer questions about local files. Use the read_file tool to read any file you need, then answer concisely.';

/** Build the file-Q&A agent with an injected tool set (e.g. the MCP read_file tools). */
export function createFileQaAgent(tools: ToolSet): Agent {
  return {
    name: 'file_qa',
    description:
      'Answers questions about, and summarizes, the contents of a specific local file using read_file.',
    model: createOllamaModel(qwenFast), // default binding; selector may override live
    systemPrompt: SYSTEM_PROMPT,
    tools,
    modelDecl: qwenFast,
    modelReq: {
      role: 'general reasoning + tool use',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  };
}
