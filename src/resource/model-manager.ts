import { ResourceError } from '../core/errors.ts';
import type { ModelDeclaration } from '../core/types.ts';
import { runtimeFor } from '../runtime/registry.ts';
import type { LoadedModel, RuntimeControl } from '../runtime/runtime.ts';
import { kvCacheBytes, weightsBytes } from './footprint.ts';
import { liveBudgetBytes } from './hardware.ts';
import {
  activeKvCacheType,
  effectiveKvBytesPerToken,
  f16KvBytesPerToken,
  isKvQuantRisky,
  KvCacheType,
} from './kv-cache.ts';

export const MIN_CTX = 4096;
const DEFAULT_KV_PER_TOKEN = 131072;
const CTX_ROUNDING = 1024;

export type EnsureOpts = { pinned?: string[] };

/** A live budget figure, or a (sync/async) provider that computes one on demand. */
export type BudgetSource = number | (() => number | Promise<number>);

/** Injectable dependencies (real runtimes by default; fakes in tests). */
export type ManagerDeps = {
  budgetBytes: BudgetSource;
  warn: (message: string) => void;
  /** Resolve the lifecycle control for a declaration's runtime. */
  controlFor: (decl: ModelDeclaration) => RuntimeControl;
};

function defaultDeps(): ManagerDeps {
  return {
    budgetBytes: liveBudgetBytes,
    warn: (message) => console.error(message),
    controlFor: (decl) => runtimeFor(decl.provider).control,
  };
}

/** Resolve the budget source to a concrete byte figure (live on each call). */
async function resolveBudget(source: BudgetSource): Promise<number> {
  return typeof source === 'function' ? source() : source;
}

/** Loads/unloads models to keep the active + pinned set within the GPU budget. */
export function createModelManager(deps: ManagerDeps = defaultDeps()) {
  const d = deps;
  const lastUsed = new Map<string, number>();
  const chosenCtxByModel = new Map<string, number>();
  const maxCtxByModel = new Map<string, number>();
  const runtimeByModel = new Map<string, ModelDeclaration>(); // remember how to unload
  const kvF16ByModel = new Map<string, number>();
  const kvRiskWarned = new Set<string>();
  let tick = 0;

  async function modelMaxFor(
    c: RuntimeControl,
    model: string,
  ): Promise<number | undefined> {
    const cached = maxCtxByModel.get(model);
    if (cached !== undefined) return cached;
    let probed: number | undefined;
    try {
      probed = await c.getModelMax(model);
    } catch {
      probed = undefined;
    }
    if (probed !== undefined) maxCtxByModel.set(model, probed);
    return probed;
  }

  async function kvF16For(
    c: RuntimeControl,
    model: string,
    decl: ModelDeclaration,
  ): Promise<number> {
    const cached = kvF16ByModel.get(model);
    if (cached !== undefined) return cached;
    let arch: Awaited<ReturnType<RuntimeControl['getModelKvArch']>>;
    try {
      arch = await c.getModelKvArch(model);
    } catch {
      arch = undefined;
    }
    if (arch) {
      // generalized, arch-derived risk advisory (type is global, so this is informational)
      const type = activeKvCacheType();
      if (
        type !== KvCacheType.F16 &&
        isKvQuantRisky(arch) &&
        !kvRiskWarned.has(model)
      ) {
        kvRiskWarned.add(model);
        d.warn(
          `[model-manager] ${model}: arch (small head_dim / MoE) may lose accuracy under ${type} KV cache; set AGENT_KV_CACHE_TYPE=f16 if quality matters for it.`,
        );
      }
    }
    const f16 = arch
      ? f16KvBytesPerToken(arch)
      : (decl.footprint.kvBytesPerToken ?? DEFAULT_KV_PER_TOKEN);
    kvF16ByModel.set(model, f16);
    return f16;
  }

  async function ensureReady(
    decl: ModelDeclaration,
    opts: EnsureOpts = {},
  ): Promise<number> {
    const c = d.controlFor(decl);
    const pinned = new Set(opts.pinned ?? []);
    const target = decl.model;
    const desired = decl.params.numCtx ?? MIN_CTX;

    if (!(await c.isInstalled(target))) await c.pull(target);

    let loaded = await c.listLoaded();
    if (loaded.some((m) => m.name === target)) {
      lastUsed.set(target, ++tick);
      return chosenCtxByModel.get(target) ?? desired;
    }

    const weights = weightsBytes(
      decl.footprint.approxParamsBillions,
      decl.footprint.bytesPerWeight,
    );
    const f16Base = await kvF16For(c, target, decl);
    const kvPerToken = effectiveKvBytesPerToken(f16Base);
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
      await c.unload(evict.name);
      lastUsed.delete(evict.name);
      chosenCtxByModel.delete(evict.name);
      headroom += evict.sizeBytes;
      loaded = loaded.filter((m) => m.name !== evict.name);
    }

    // Scale context up into the remaining headroom, clamped by the live model max.
    const probedMax = await modelMaxFor(c, target);
    const ceiling = Math.min(
      decl.maxContext ?? Number.POSITIVE_INFINITY,
      probedMax ?? Number.POSITIVE_INFINITY,
    );
    const maxCtxByFit = Math.floor((headroom - weights) / kvPerToken);
    let chosenCtx = Math.min(desired, ceiling, maxCtxByFit);
    chosenCtx = Math.max(MIN_CTX, chosenCtx);
    chosenCtx -= chosenCtx % CTX_ROUNDING;
    chosenCtx = Math.max(MIN_CTX, chosenCtx);

    await c.warm(target, chosenCtx);
    lastUsed.set(target, ++tick);
    chosenCtxByModel.set(target, chosenCtx);
    runtimeByModel.set(target, decl);
    return chosenCtx;
  }

  async function unloadAll(): Promise<void> {
    for (const model of [...lastUsed.keys()]) {
      const decl = runtimeByModel.get(model);
      if (decl) await d.controlFor(decl).unload(model);
    }
    lastUsed.clear();
    chosenCtxByModel.clear();
    runtimeByModel.clear();
  }

  return { ensureReady, unloadAll };
}
