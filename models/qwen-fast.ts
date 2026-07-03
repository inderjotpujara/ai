import {
  Capability,
  type ModelDeclaration,
  RuntimeKind,
} from '../src/core/types.ts';

/** Fast general-purpose local model with reliable tool-calling. */
const qwenFast: ModelDeclaration = {
  runtime: RuntimeKind.Ollama,
  model: 'qwen3.5:9b',
  params: { temperature: 0.2, numCtx: 16384 },
  role: 'general reasoning + tool use',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 9, bytesPerWeight: 0.56 },
};

export default qwenFast;
