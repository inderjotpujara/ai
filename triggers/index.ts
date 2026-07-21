import type { TriggerInput } from '../src/triggers/types.ts';
// TRIGGER-BUILDER:IMPORTS (generated trigger imports are inserted above this line — do not remove)

/** A repo-defined trigger never sets its own `origin` — `sync.ts` stamps
 *  `TriggerOrigin.Repo` on every entry as it syncs this registry into the
 *  store (mirrors `crews/index.ts` / `workflows/index.ts`). */
export type TriggerDef = Omit<TriggerInput, 'origin'>;

/** name -> repo trigger definition (mirrors crews/index.ts). Ships empty —
 *  populate via the trigger builder or by hand, then `syncRepoTriggers` picks
 *  it up at daemon boot. */
export const TRIGGERS: Record<string, TriggerDef> = {
  // TRIGGER-BUILDER:ENTRIES (generated trigger entries are inserted above this line — do not remove)
};

export function getTrigger(name: string): TriggerDef | undefined {
  // `Object.hasOwn` guard — a plain `TRIGGERS[name]` would return truthy
  // Object.prototype members for `__proto__`/`constructor`/`toString`, letting
  // those keys slip past every `if (!def)` 404/lookup guard (a spurious 500, or
  // a minted run dir for a non-existent trigger).
  return Object.hasOwn(TRIGGERS, name) ? TRIGGERS[name] : undefined;
}
