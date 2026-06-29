/** Which local runtime backs a model. String enum per project style. */
export enum ProviderKind {
  Ollama = 'Ollama',
}

/** Tunable inference parameters carried by a model declaration. */
export type ModelParams = {
  temperature?: number;
  numCtx?: number;
};

/**
 * A model declaration is DATA, not logic. Slice 1 pins a concrete model name;
 * later slices can resolve a capability/role to a discovered model.
 */
export type ModelDeclaration = {
  provider: ProviderKind;
  model: string;
  params: ModelParams;
  role: string;
  /** Pre-load sizing hint for the model manager. */
  footprint: {
    approxParamsBillions: number;
    bytesPerWeight: number;
    /** Bytes of KV cache per token (per-model; defaults to 131072 if omitted). */
    kvBytesPerToken?: number;
  };
  /**
   * Optional cap on the context window. The true max is detected live from
   * Ollama; set this only to deliberately cap below it or as a probe fallback.
   */
  maxContext?: number;
};
