import { ResourceError } from '../core/errors.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { estimateModelBytes } from './footprint.ts';
import { machineBudgetBytes } from './hardware.ts';
import {
  isModelInstalled,
  type LoadedModel,
  listLoadedModels,
  pullModel,
  unloadModel,
  warmModel,
} from './ollama-control.ts';

export type EnsureOpts = { pinned?: string[] };

/** Injectable dependencies (real Ollama by default; fakes in tests). */
export type ManagerDeps = {
  budgetBytes: number;
  isInstalled: (model: string) => Promise<boolean>;
  listLoaded: () => Promise<LoadedModel[]>;
  pull: (model: string) => Promise<void>;
  warm: (model: string) => Promise<void>;
  unload: (model: string) => Promise<void>;
};

/** Estimated resident bytes of a model from its declaration. */
export function declBytes(decl: ModelDeclaration): number {
  return estimateModelBytes({
    paramsBillions: decl.footprint.approxParamsBillions,
    bytesPerWeight: decl.footprint.bytesPerWeight,
    contextTokens: decl.params.numCtx ?? 8192,
    kvBytesPerToken: 131072,
  });
}

function defaultDeps(): ManagerDeps {
  return {
    budgetBytes: machineBudgetBytes(),
    isInstalled: (m) => isModelInstalled(m),
    listLoaded: () => listLoadedModels(),
    pull: (m) => pullModel(m),
    warm: (m) => warmModel(m),
    unload: (m) => unloadModel(m),
  };
}

/** Loads/unloads models to keep the active + pinned set within the GPU budget. */
export function createModelManager(deps: Partial<ManagerDeps> = {}) {
  const d: ManagerDeps = { ...defaultDeps(), ...deps };
  const lastUsed = new Map<string, number>();
  let tick = 0;

  async function ensureReady(
    decl: ModelDeclaration,
    opts: EnsureOpts = {},
  ): Promise<void> {
    const pinned = new Set(opts.pinned ?? []);
    const target = decl.model;

    if (!(await d.isInstalled(target))) await d.pull(target);

    let loaded = await d.listLoaded();
    if (loaded.some((m) => m.name === target)) {
      lastUsed.set(target, ++tick);
      return;
    }

    const needed = declBytes(decl);
    const resident = () => loaded.reduce((sum, m) => sum + m.sizeBytes, 0);

    while (resident() + needed > d.budgetBytes) {
      const candidates = loaded
        .filter((m) => !pinned.has(m.name) && m.name !== target)
        .sort(
          (a, b) => (lastUsed.get(a.name) ?? -1) - (lastUsed.get(b.name) ?? -1),
        );
      const evict = candidates[0];
      if (evict === undefined) {
        throw new ResourceError(
          `Cannot load ${target} (~${Math.round(needed / 1e9)}GB): only pinned models remain and the budget (~${Math.round(d.budgetBytes / 1e9)}GB) is exceeded.`,
        );
      }
      await d.unload(evict.name);
      lastUsed.delete(evict.name);
      loaded = loaded.filter((m) => m.name !== evict.name);
    }

    await d.warm(target);
    lastUsed.set(target, ++tick);
  }

  async function unloadAll(): Promise<void> {
    for (const model of [...lastUsed.keys()]) {
      await d.unload(model);
    }
    lastUsed.clear();
  }

  return { ensureReady, unloadAll };
}
