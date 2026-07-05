import type { ModelDeclaration } from '../core/types.ts';

/** Identity of the thing that could be down. Today: the runtime. */
export type FailureDomain = string;

export function failureDomain(decl: ModelDeclaration): FailureDomain {
  return String(decl.runtime);
}

/**
 * Reorder candidates (already best-first) so no two CONSECUTIVE entries share a
 * failure domain when a different-domain candidate is available — so a dead
 * daemon isn't "degraded" to another model behind the same daemon. Stable:
 * relative order within a domain is preserved; falls back to the input order
 * when only one domain exists.
 */
export function degradeChain(
  candidates: ModelDeclaration[],
): ModelDeclaration[] {
  const remaining = [...candidates];
  const out: ModelDeclaration[] = [];
  let lastDomain: FailureDomain | undefined;
  while (remaining.length > 0) {
    let idx = remaining.findIndex((d) => failureDomain(d) !== lastDomain);
    if (idx === -1) idx = 0; // only same-domain left
    const removed = remaining.splice(idx, 1);
    const picked = removed[0];
    if (picked === undefined) {
      throw new Error('unreachable: remaining should not be empty');
    }
    out.push(picked);
    lastDomain = failureDomain(picked);
  }
  return out;
}
