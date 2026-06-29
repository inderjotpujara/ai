import {
  type Capability,
  type ModelDeclaration,
  type ModelRequirement,
} from '../core/types.ts';
import { weightsBytes } from './footprint.ts';

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
  const capable = registry.filter((d) => hasAll(d, req.requires));
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
