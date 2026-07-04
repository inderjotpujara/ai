export type QuantFile = { quant: string; sizeBytes: number };

/**
 * Approximate bytes-per-weight for common GGUF/MLX quant labels.
 *
 * Q4_0/Q4_K_M were 0.56, measured from raw quantized-weight bits only; real
 * loaded footprints run closer to ~0.6 B/param once GGUF metadata/tensor
 * padding/embedding-table overhead is included (Slice-14 follow-on, WS4 —
 * see .superpowers/sdd, provisioning findings). Bumped to stop under-sizing.
 */
const BPW: Record<string, number> = {
  Q2_K: 0.34,
  Q3_K_M: 0.43,
  Q4_0: 0.6,
  Q4_K_M: 0.6,
  Q4_K_S: 0.52,
  Q5_K_M: 0.7,
  Q5_0: 0.68,
  Q6_K: 0.82,
  Q8_0: 1.06,
  IQ4_XS: 0.5,
  '4BIT': 0.55,
  '8BIT': 1.06,
  FP16: 2.0,
  F16: 2.0,
};

/** Bytes/weight for a quant label (case-insensitive); falls back to Q4_K_M-ish. */
export function bytesPerWeightForQuant(quant: string): number {
  return BPW[quant.toUpperCase()] ?? 0.6;
}

/** Largest quant file that fits the budget (file size ≈ weights footprint). */
export function pickBestQuantThatFits(
  files: QuantFile[],
  budgetBytes: number,
): QuantFile | undefined {
  return [...files]
    .filter((f) => f.sizeBytes <= budgetBytes)
    .sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
}
