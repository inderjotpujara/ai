import type { ModelDeclaration } from '../core/types.ts';
import { RuntimeKind } from '../core/types.ts';
import { withMemoryEmbedSpan } from '../telemetry/spans.ts';

const DEFAULT_BASE = 'http://localhost:11434';

/** Weights-only model declaration for an embedder (no KV cache to budget). */
export function embedderDecl(model: string): ModelDeclaration {
  return {
    runtime: RuntimeKind.Ollama,
    model,
    params: {},
    role: 'embedder',
    footprint: {
      approxParamsBillions: 0.6,
      bytesPerWeight: 1,
      kvBytesPerToken: 0,
    },
  };
}

/** Probe embedder dim + max input via /api/show (mirrors getModelMaxContext). */
export async function probeEmbedder(
  model: string,
  baseUrl = DEFAULT_BASE,
): Promise<{ dim: number; maxInput: number }> {
  const res = await fetch(`${baseUrl}/api/show`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  const data = (await res.json()) as { model_info?: Record<string, unknown> };
  const info = data.model_info ?? {};
  const arch = info['general.architecture'];
  if (typeof arch !== 'string')
    throw new Error(`cannot probe embedder ${model}`);
  const dim = info[`${arch}.embedding_length`];
  const maxInput = info[`${arch}.context_length`];
  return {
    dim: typeof dim === 'number' ? dim : 768,
    maxInput: typeof maxInput === 'number' ? maxInput : 2048,
  };
}

export type EmbedderDeps = {
  ensureReady: (decl: ModelDeclaration) => Promise<number>;
  control: { embed(model: string, texts: string[]): Promise<number[][]> };
  model: string;
};

/** Manager-backed embedder: ensure-loaded (weights-only) then embed, traced. */
export function makeEmbedder(deps: EmbedderDeps) {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      await deps.ensureReady(embedderDecl(deps.model));
      return withMemoryEmbedSpan(
        { model: deps.model, count: texts.length },
        () => deps.control.embed(deps.model, texts),
      );
    },
  };
}
