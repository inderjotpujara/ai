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
  footprint: { approxParamsBillions: number; bytesPerWeight: number };
};
