import { type ModelDeclaration, ProviderKind } from '../src/core/types.ts';

/** Fast general-purpose local model with reliable tool-calling. */
const qwenFast: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:9b',
  params: { temperature: 0.2, numCtx: 8192 },
  role: 'general reasoning + tool use',
  footprint: { approxParamsBillions: 9, bytesPerWeight: 0.56 },
};

export default qwenFast;
