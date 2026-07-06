import type { ToolSet } from 'ai';
import qwenFast from '../models/qwen-fast.ts';
import type { Agent } from '../src/core/agent-def.ts';
import { Capability, PreferPolicy } from '../src/core/types.ts';
import { createOllamaModel } from '../src/providers/ollama.ts';

const SYSTEM_PROMPT =
  'You create images, audio, and video from text. Call generate_image / generate_speech / generate_video with a clear prompt, then tell the user where the file was written. Video generation can take minutes — let the user know to expect a wait.';

/** Build the media-creator agent with an injected tool set (e.g. the
 *  generate_image / generate_speech / generate_video tools bound to the
 *  run's MediaStore). */
export function createMediaCreatorAgent(tools: ToolSet): Agent {
  return {
    name: 'media_creator',
    description:
      'Generates images, speech/audio, and video from text descriptions.',
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
