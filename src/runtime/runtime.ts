import type { LanguageModel } from 'ai';
import type { ModelDeclaration, ProviderKind } from '../core/types.ts';
import type { LoadedModel } from '../resource/ollama-control.ts';

export type { LoadedModel };

/** Lifecycle the Model Manager drives, abstracted per runtime. */
export type RuntimeControl = {
  isInstalled(model: string): Promise<boolean>;
  pull(model: string): Promise<void>;
  warm(model: string, numCtx?: number): Promise<void>;
  unload(model: string): Promise<void>;
  listLoaded(): Promise<LoadedModel[]>;
  getModelMax(model: string): Promise<number | undefined>;
};

/** A model runtime: builds AI-SDK models and owns their lifecycle + availability. */
export type Runtime = {
  kind: ProviderKind;
  isAvailable(): Promise<boolean>;
  createModel(decl: ModelDeclaration): LanguageModel;
  control: RuntimeControl;
};
