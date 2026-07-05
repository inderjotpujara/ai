import { ProviderError, ResourceError } from '../core/errors.ts';
import {
  type Capability,
  ContentPolicy,
  type ModelDeclaration,
  type ModelRequirement,
} from '../core/types.ts';
import { degradeChain } from '../reliability/degrade.ts';
import { weightsBytes } from './footprint.ts';
import type { EnsureOpts } from './model-manager.ts';
import type { LoadedModel } from './ollama-control.ts';

function hasAll(decl: ModelDeclaration, requires: Capability[]): boolean {
  const caps = new Set(decl.capabilities ?? []);
  return requires.every((c) => caps.has(c));
}

/**
 * PURE. Hard-filter by `requires`, then rank by `prefer`.
 * LargestThatFits: most params first; tie-break smaller footprint; then a
 * warm-aware bias (resident wins among otherwise-equal candidates) to avoid
 * needless reload churn. The fits check itself is the manager's job, not here.
 */
export function selectCandidates(
  req: ModelRequirement,
  registry: ModelDeclaration[],
  loaded?: ReadonlySet<string>,
): ModelDeclaration[] {
  const capable = registry.filter(
    (d) =>
      hasAll(d, req.requires) &&
      (req.allowUncensored === true ||
        d.contentPolicy !== ContentPolicy.Uncensored),
  );
  return [...capable].sort((a, b) => {
    const pa = a.footprint.approxParamsBillions;
    const pb = b.footprint.approxParamsBillions;
    if (pb !== pa) return pb - pa; // largest params first
    const fa = weightsBytes(pa, a.footprint.bytesPerWeight);
    const fb = weightsBytes(pb, b.footprint.bytesPerWeight);
    if (fa !== fb) return fa - fb; // smaller footprint first
    if (loaded) {
      const la = loaded.has(a.model) ? 0 : 1;
      const lb = loaded.has(b.model) ? 0 : 1;
      if (la !== lb) return la - lb; // resident first
    }
    return 0;
  });
}

/** Dependencies for the live resolve loop. */
export type ResolveDeps = {
  ensureReady: (d: ModelDeclaration, o?: EnsureOpts) => Promise<number>;
  /** Optional resident-set probe; enables the warm-aware bias. */
  listLoaded?: () => Promise<LoadedModel[]>;
  /** Optional callback fired before each ensureReady attempt (e.g. selection notice). */
  onAttempt?: (decl: ModelDeclaration) => void | Promise<void>;
};

/**
 * LIVE. Walk candidates best-first; the first the manager can ready wins. On a
 * genuine ResourceError (doesn't fit) or ProviderError (pull/warm failed, e.g. the
 * runtime can't fetch the model), drop to the next candidate; if none fit, rethrow a
 * real ResourceError. The manager remains the single fit-authority (real /api/ps
 * sizes).
 */
export async function resolveModel(
  req: ModelRequirement,
  registry: ModelDeclaration[],
  deps: ResolveDeps,
  opts?: EnsureOpts,
): Promise<{ decl: ModelDeclaration; numCtx: number }> {
  const loaded = deps.listLoaded
    ? new Set((await deps.listLoaded()).map((mm) => mm.name))
    : undefined;
  const candidates = degradeChain(selectCandidates(req, registry, loaded));
  if (candidates.length === 0) {
    throw new ResourceError(
      `No model in the registry satisfies requirements: ${req.requires.join(', ')}.`,
    );
  }
  let lastErr: unknown;
  for (const decl of candidates) {
    await deps.onAttempt?.(decl);
    try {
      const numCtx = await deps.ensureReady(decl, opts);
      return { decl, numCtx };
    } catch (err) {
      if (err instanceof ResourceError || err instanceof ProviderError) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw new ResourceError(
    `No candidate model fits the live budget for ${req.role}.`,
    {
      cause: lastErr,
    },
  );
}
