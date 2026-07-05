import {
  Capability,
  type ModelDeclaration,
  RuntimeKind,
} from '../src/core/types.ts';

/** Vision analysis local model for multimodal understanding. */
const qwenVision: ModelDeclaration = {
  runtime: RuntimeKind.Ollama,
  model: 'qwen2.5vl:7b',
  params: { temperature: 0.2, numCtx: 16384 },
  role: 'vision analysis',
  capabilities: [Capability.Vision],
  footprint: { approxParamsBillions: 7, bytesPerWeight: 0.56 },
};

export default qwenVision;
