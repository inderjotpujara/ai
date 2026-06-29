import { ResourceError } from '../core/errors.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { kvCacheBytes, weightsBytes } from './footprint.ts';
import { liveBudgetBytes } from './hardware.ts';
import {
  getModelMaxContext,
  isModelInstalled,
  type LoadedModel,
  listLoadedModels,
  pullModel,
  unloadModel,
  warmModel,
} from './ollama-control.ts';

export const MIN_CTX = 4096;
const DEFAULT_KV_PER_TOKEN = 131072;
const CTX_ROUNDING = 1024;

export type EnsureOpts = { pinned?: string[] };

/** A live budget figure, or a (sync/async) provider that computes one on demand. */
export type BudgetSource = number | (() => number | Promise<number>);

/** Injectable dependencies (real Ollama by default; fakes in tests). */
export type ManagerDeps = {
  budgetBytes: BudgetSource;
  isInstalled: (model: string) => Promise<boolean>;
  listLoaded: () => Promise<LoadedModel[]>;
  pull: (model: string) => Promise<void>;
  warm: (model: string, numCtx?: number) => Promise<void>;
  unload: (model: string) => Promise<void>;
  warn: (message: string) => void;
  getModelMax: (model: string) => Promise<number | undefined>;
};

function defaultDeps(): ManagerDeps {
  return {
    budgetBytes: liveBudgetBytes,
    isInstalled: (m) => isModelInstalled(m),
    listLoaded: () => listLoadedModels(),
    pull: (m) => pullModel(m),
    warm: (m, n) => warmModel(m, n),
    unload: (m) => unloadModel(m),
    warn: (message) => console.error(message),
    getModelMax: (m) => getModelMaxContext(m),
  };
}

/** Resolve the budget source to a concrete byte figure (live on each call). */
async function resolveBudget(source: BudgetSource): Promise<number> {
  return typeof source === 'function' ? source() : source;
}

/** Loads/unloads models to keep the active + pinned set within the GPU budget. */
export function createModelManager(deps: Partial<ManagerDeps> = {}) {
  const d: ManagerDeps = { ...defaultDeps(), ...deps };
  const lastUsed = new Map<string, number>();
  const chosenCtxByModel = new Map<string, number>();
  const maxCtxByModel = new Map<string, number>();
  let tick = 0;

  async function modelMaxFor(model: string): Promise<number | undefined> {
    const cached = maxCtxByModel.get(model);
    if (cached !== undefined) return cached;
    let probed: number | undefined;
    try {
      probed = await d.getModelMax(model);
    } catch {
      probed = undefined;
    }
    if (probed !== undefined) maxCtxByModel.set(model, probed);
    return probed;
  }

  async function ensureReady(
    decl: ModelDeclaration,
    opts: EnsureOpts = {},
  ): Promise<number> {
    const pinned = new Set(opts.pinned ?? []);
    const target = decl.model;
    const desired = decl.params.numCtx ?? MIN_CTX;

    if (!(await d.isInstalled(target))) await d.pull(target);

    let loaded = await d.listLoaded();
    if (loaded.some((m) => m.name === target)) {
      lastUsed.set(target, ++tick);
      return chosenCtxByModel.get(target) ?? desired;
    }

    const weights = weightsBytes(
      decl.footprint.approxParamsBillions,
      decl.footprint.bytesPerWeight,
    );
    const kvPerToken = decl.footprint.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN;
    const minNeed = weights + kvCacheBytes(MIN_CTX, kvPerToken);
    const freeBudget = await resolveBudget(d.budgetBytes);
    const gb = (bytes: number) => Math.round(bytes / 1e9);

    const lru = (a: LoadedModel, b: LoadedModel) =>
      (lastUsed.get(a.name) ?? -1) - (lastUsed.get(b.name) ?? -1);

    // Fit the model at its minimum context; evicting returns real bytes to headroom.
    let headroom = freeBudget;
    while (minNeed > headroom) {
      const evictable = loaded.filter((m) => m.name !== target);
      const nonPinned = evictable.filter((m) => !pinned.has(m.name)).sort(lru);
      const evict = nonPinned[0] ?? evictable.sort(lru)[0];
      if (evict === undefined) {
        throw new ResourceError(
          `Cannot load ${target} (needs ~${gb(minNeed)}GB at min context): it exceeds the live memory budget (~${gb(freeBudget)}GB) even after evicting every other model.`,
        );
      }
      if (pinned.has(evict.name)) {
        d.warn(
          `[model-manager] live memory budget (~${gb(freeBudget)}GB) too low to keep ${evict.name} pinned; evicting it to load ${target} (best-effort pin — it will reload on demand).`,
        );
      }
      await d.unload(evict.name);
      lastUsed.delete(evict.name);
      chosenCtxByModel.delete(evict.name);
      headroom += evict.sizeBytes;
      loaded = loaded.filter((m) => m.name !== evict.name);
    }

    // Scale context up into the remaining headroom, clamped by the live model max.
    const probedMax = await modelMaxFor(target);
    const ceiling = Math.min(
      decl.maxContext ?? Number.POSITIVE_INFINITY,
      probedMax ?? Number.POSITIVE_INFINITY,
    );
    const maxCtxByFit = Math.floor((headroom - weights) / kvPerToken);
    let chosenCtx = Math.min(desired, ceiling, maxCtxByFit);
    chosenCtx = Math.max(MIN_CTX, chosenCtx);
    chosenCtx -= chosenCtx % CTX_ROUNDING;
    chosenCtx = Math.max(MIN_CTX, chosenCtx);

    await d.warm(target, chosenCtx);
    lastUsed.set(target, ++tick);
    chosenCtxByModel.set(target, chosenCtx);
    return chosenCtx;
  }

  async function unloadAll(): Promise<void> {
    for (const model of [...lastUsed.keys()]) {
      await d.unload(model);
    }
    lastUsed.clear();
    chosenCtxByModel.clear();
  }

  return { ensureReady, unloadAll };
}
