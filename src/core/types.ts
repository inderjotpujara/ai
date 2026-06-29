/** Which local runtime backs a model. String enum per project style. */
export enum ProviderKind {
  Ollama = 'Ollama',
}

/** A capability a model advertises and an agent can require. String enum (extensible). */
export enum Capability {
  Tools = 'tools',
  // future: Vision = 'vision', LongContext = 'long-context', Coding = 'coding'
}

/** How the selector ranks the candidates that survive the hard filter. */
export enum PreferPolicy {
  LargestThatFits = 'largest-that-fits',
  // future: SmallestThatFits, QualityRanked, GlobalSchedule
}

/** What a requirement-driven agent declares instead of a concrete model name. */
export type ModelRequirement = {
  /** Human description of the role. */
  role: string;
  /** HARD filter — every listed capability must be present on the model. */
  requires: Capability[];
  /** SOFT rank over the survivors. */
  prefer: PreferPolicy;
};

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
  /** Capabilities this model provides; selector hard-filters on these. Missing = none. */
  capabilities?: Capability[];
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
