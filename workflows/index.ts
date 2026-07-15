import type { WorkflowDef } from '../src/workflow/types.ts';
import fetchThenSummarize from './fetch-then-summarize.ts';
// CREW-BUILDER:IMPORTS (generated workflow imports are inserted above this line — do not remove)

/** name → workflow definition (mirrors models/registry.ts). */
export const WORKFLOWS: Record<string, WorkflowDef> = {
  [fetchThenSummarize.id]: fetchThenSummarize,
  // CREW-BUILDER:ENTRIES (generated workflow entries are inserted above this line — do not remove)
};

export function getWorkflow(name: string): WorkflowDef | undefined {
  // `Object.hasOwn` guard — a plain `WORKFLOWS[name]` would return truthy
  // Object.prototype members for `__proto__`/`constructor`/`toString`, letting
  // those keys slip past every `if (!def)` 404/lookup guard (a spurious 500, or
  // a minted run dir for a non-existent workflow).
  return Object.hasOwn(WORKFLOWS, name) ? WORKFLOWS[name] : undefined;
}
