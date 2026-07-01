import type { CrewDef } from '../src/crew/types.ts';
import researchCrew from './research-crew.ts';

/** name -> crew definition (mirrors workflows/index.ts). */
export const CREWS: Record<string, CrewDef> = {
  [researchCrew.id]: researchCrew,
};

export function getCrew(name: string): CrewDef | undefined {
  return CREWS[name];
}
