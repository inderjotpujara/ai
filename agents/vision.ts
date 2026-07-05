import type { ToolSet } from 'ai';
import qwenVision from '../models/qwen-vision.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { Capability, PreferPolicy } from '../src/core/types.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';

const SYSTEM_PROMPT =
  'You describe and answer questions about images. Be concise and specific about what you see.';

/** Build the vision analysis agent with an injected tool set (e.g. the MCP image analysis tools). */
export function createVisionAgent(tools: ToolSet): Agent {
  return {
    name: 'vision',
    description:
      'Describes and answers questions about images and video frames.',
    model: createOllamaModel(qwenVision), // default binding; selector may override live
    systemPrompt: SYSTEM_PROMPT,
    tools,
    modelDecl: qwenVision,
    modelReq: {
      role: 'vision analysis',
      requires: [Capability.Vision],
      prefer: PreferPolicy.LargestThatFits,
    },
  };
}
