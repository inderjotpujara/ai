import type { CrewDef } from '../src/crew/types.ts';
import researchCrew from './research-crew.ts';
// CREW-BUILDER:IMPORTS (generated crew imports are inserted above this line — do not remove)

/** name -> crew definition (mirrors workflows/index.ts). */
export const CREWS: Record<string, CrewDef> = {
  [researchCrew.id]: researchCrew,
  // CREW-BUILDER:ENTRIES (generated crew entries are inserted above this line — do not remove)
};

export function getCrew(name: string): CrewDef | undefined {
  // `Object.hasOwn` guard — a plain `CREWS[name]` would return truthy
  // Object.prototype members for `__proto__`/`constructor`/`toString`, letting
  // those keys slip past every `if (!def)` 404/lookup guard (a spurious 500, or
  // a minted run dir for a non-existent crew).
  return Object.hasOwn(CREWS, name) ? CREWS[name] : undefined;
}
