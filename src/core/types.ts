/** Which downloader fetches a model's weights. String enum per project style. */
export enum ProviderKind {
  Ollama = 'Ollama', // pull via the local Ollama daemon
  HfGguf = 'HfGguf', // single GGUF file from a HuggingFace repo (repo::file.gguf)
  HfSnapshot = 'HfSnapshot', // whole-repo snapshot (MLX weights) from HuggingFace
  LmStudio = 'LmStudio', // download via the local LM Studio REST server
}

/** Which local engine runs inference for a model. */
export enum RuntimeKind {
  Ollama = 'Ollama', // GGUF via llama.cpp Metal (MLX engine auto on >32GB hosts)
  MlxServer = 'MlxServer', // MLX via a local OpenAI-compatible server (mlx_lm / LM Studio)
  LmStudio = 'LmStudio', // LM Studio as an inference runtime
  LlamaCpp = 'LlamaCpp', // GGUF via a managed llama.cpp-server (-c dynamic context)
}

/** A capability a model advertises and an agent can require. Selector hard-filters on these. */
export enum Capability {
  Tools = 'tools',
  Vision = 'vision', // image input (Slice 8)
  Audio = 'audio', // speech in/out (Slice 9)
  Video = 'video', // frames/clips (Slice 10)
}

/** Content moderation posture. Uncensored is gated behind a future mode (Slice 11). */
export enum ContentPolicy {
  Default = 'default',
  Uncensored = 'uncensored',
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
  /** If true, uncensored models are eligible. Absent/false = filtered out. */
  allowUncensored?: boolean;
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
  runtime: RuntimeKind;
  model: string;
  params: ModelParams;
  role: string;
  /** Capabilities this model provides; selector hard-filters on these. Missing = none. */
  capabilities?: Capability[];
  /** Moderation posture; absent = Default. */
  contentPolicy?: ContentPolicy;
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
  /**
   * A valid Ollama model tag to use when this declaration's runtime is
   * unreachable and selection degrades to Ollama. Non-Ollama runtimes (e.g.
   * MLX/HF repo ids) are not resolvable by Ollama, so without this the
   * degrade path honestly reuses `model` (and logs it) rather than guessing.
   */
  fallbackModel?: string;
};
