import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { Capability, PreferPolicy } from '../src/core/types.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';

const SYSTEM_PROMPT =
  'You answer questions about web pages. Use the fetch tool to retrieve the given URL, then answer or summarize concisely based on the page content.';

/** Build the web-fetch agent with an injected tool set (the mounted `fetch` tool). */
export function createWebFetchAgent(tools: ToolSet): Agent {
  return {
    name: 'web_fetch',
    description:
      'Fetches a URL and answers questions about or summarizes the content of a web page.',
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
