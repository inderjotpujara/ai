/** Inputs for a rough pre-load RAM estimate of a quantized model. */
export type FootprintInput = {
  paramsBillions: number;
  bytesPerWeight: number;
  contextTokens: number;
  kvBytesPerToken: number;
};

const RUNTIME_OVERHEAD = 1.2;

/** Resident bytes of the weights (quantized) plus runtime overhead — no KV cache. */
export function weightsBytes(
  paramsBillions: number,
  bytesPerWeight: number,
): number {
  return paramsBillions * 1e9 * bytesPerWeight * RUNTIME_OVERHEAD;
}

/** KV-cache bytes for a given context window. */
export function kvCacheBytes(
  contextTokens: number,
  kvBytesPerToken: number,
): number {
  return contextTokens * kvBytesPerToken;
}

/**
 * Estimate the RAM a model needs before loading it.
 * weights (with overhead) plus a KV-cache term that grows with context.
 */
export function estimateModelBytes(input: FootprintInput): number {
  return (
    weightsBytes(input.paramsBillions, input.bytesPerWeight) +
    kvCacheBytes(input.contextTokens, input.kvBytesPerToken)
  );
}
