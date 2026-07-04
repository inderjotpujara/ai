import {
  Capability,
  type ModelDeclaration,
  RuntimeKind,
} from '../src/core/types.ts';

/** Small, fast model for the orchestrator's routing decisions (stays pinned-resident). */
const qwenRouter: ModelDeclaration = {
  runtime: RuntimeKind.Ollama,
  model: 'qwen3.5:4b',
  params: { temperature: 0.1, numCtx: 8192 },
  role: 'routing / orchestration',
  capabilities: [Capability.Tools],
  footprint: { approxParamsBillions: 4, bytesPerWeight: 0.56 },
};

export default qwenRouter;
