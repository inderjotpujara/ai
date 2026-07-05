import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { Capability, PreferPolicy } from '../src/core/types.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';

const SYSTEM_PROMPT =
  'You create images and audio from text. Call generate_image / generate_speech with a clear prompt, then tell the user where the file was written.';

/** Build the media-creator agent with an injected tool set (e.g. the
 *  generate_image / generate_speech tools bound to the run's MediaStore). */
export function createMediaCreatorAgent(tools: ToolSet): Agent {
  return {
    name: 'media_creator',
    description: 'Generates images and speech/audio from text descriptions.',
    model: createOllamaModel(qwenFast), // default binding; selector may override live
    systemPrompt: SYSTEM_PROMPT,
    tools,
    modelDecl: qwenFast,
    modelReq: {
      role: 'media generation (tool use)',
      requires: [Capability.Tools],
      prefer: PreferPolicy.LargestThatFits,
    },
  };
}
