import { ResourceError } from '../core/errors.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { estimateModelBytes } from './footprint.ts';
import { liveBudgetBytes } from './hardware.ts';
import {
  isModelInstalled,
  type LoadedModel,
  listLoadedModels,
  pullModel,
  unloadModel,
  warmModel,
} from './ollama-control.ts';

export type EnsureOpts = { pinned?: string[] };

/** A live budget figure, or a (sync/async) provider that computes one on demand. */
export type BudgetSource = number | (() => number | Promise<number>);

/** Injectable dependencies (real Ollama by default; fakes in tests). */
export type ManagerDeps = {
  budgetBytes: BudgetSource;
  isInstalled: (model: string) => Promise<boolean>;
  listLoaded: () => Promise<LoadedModel[]>;
  pull: (model: string) => Promise<void>;
  warm: (model: string) => Promise<void>;
  unload: (model: string) => Promise<void>;
  warn: (message: string) => void;
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
    budgetBytes: liveBudgetBytes,
    isInstalled: (m) => isModelInstalled(m),
    listLoaded: () => listLoadedModels(),
    pull: (m) => pullModel(m),
    warm: (m) => warmModel(m),
    unload: (m) => unloadModel(m),
    warn: (message) => console.error(message),
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
    // Free headroom right now, resolved live per delegation. This is free system
    // RAM (already net of every loaded model), so the question is simply "does the
    // target fit in what's free?" — never `resident() + needed`, which would
    // double-count models the free figure already excludes.
    const freeBudget = await resolveBudget(d.budgetBytes);
    const gb = (bytes: number) => Math.round(bytes / 1e9);

    const lru = (a: LoadedModel, b: LoadedModel) =>
      (lastUsed.get(a.name) ?? -1) - (lastUsed.get(b.name) ?? -1);

    // Evicting a model returns its REAL resident bytes (from /api/ps) to the pool,
    // so headroom grows as we evict. Keep evicting until the target fits.
    let headroom = freeBudget;
    while (needed > headroom) {
      const evictable = loaded.filter((m) => m.name !== target);
      // Prefer non-pinned LRU; fall back to pinned LRU (pinning is best-effort —
      // under real memory pressure we degrade and let the pinned model reload on
      // its next turn rather than failing the run).
      const nonPinned = evictable.filter((m) => !pinned.has(m.name)).sort(lru);
      const evict = nonPinned[0] ?? evictable.sort(lru)[0];
      if (evict === undefined) {
        // Nothing left to evict and it still doesn't fit — a genuine resource
        // failure (the model is too big for this machine's free RAM right now).
        throw new ResourceError(
          `Cannot load ${target} (~${gb(needed)}GB): it exceeds the live memory budget (~${gb(freeBudget)}GB) even after evicting every other model.`,
        );
      }
      if (pinned.has(evict.name)) {
        d.warn(
          `[model-manager] live memory budget (~${gb(freeBudget)}GB) too low to keep ${evict.name} pinned; evicting it to load ${target} (best-effort pin — it will reload on demand).`,
        );
      }
      await d.unload(evict.name);
      lastUsed.delete(evict.name);
      headroom += evict.sizeBytes;
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
