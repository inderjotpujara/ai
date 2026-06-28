import { ProviderKind, type ModelDeclaration } from '../src/core/types.ts';

/** Fast general-purpose local model with reliable tool-calling. */
const qwenFast: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3:8b',
  params: { temperature: 0.2, numCtx: 8192 },
  role: 'general reasoning + tool use',
};

export default qwenFast;
