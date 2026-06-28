/** Inputs for a rough pre-load RAM estimate of a quantized model. */
export type FootprintInput = {
  paramsBillions: number;
  bytesPerWeight: number;
  contextTokens: number;
  kvBytesPerToken: number;
};

const RUNTIME_OVERHEAD = 1.2;

/**
 * Estimate the RAM a model needs before loading it.
 * weights = params * bytesPerWeight * overhead; plus a KV-cache term that grows with context.
 */
export function estimateModelBytes(input: FootprintInput): number {
  const weights =
    input.paramsBillions * 1e9 * input.bytesPerWeight * RUNTIME_OVERHEAD;
  const kvCache = input.contextTokens * input.kvBytesPerToken;
  return weights + kvCache;
}
