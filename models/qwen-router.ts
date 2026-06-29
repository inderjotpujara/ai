import { type ModelDeclaration, ProviderKind } from '../src/core/types.ts';

/** Small, fast model for the orchestrator's routing decisions (stays pinned-resident). */
const qwenRouter: ModelDeclaration = {
  provider: ProviderKind.Ollama,
  model: 'qwen3.5:4b',
  // Desired context for the role; the true max is detected live from Ollama
  // and the manager clamps this down under memory pressure.
  params: { temperature: 0.1, numCtx: 8192 },
  role: 'routing / orchestration',
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
};

export default qwenRouter;
