import type { WorkflowDef } from '../src/workflow/types.ts';
import fetchThenSummarize from './fetch-then-summarize.ts';
// CREW-BUILDER:IMPORTS (generated workflow imports are inserted above this line — do not remove)

/** name → workflow definition (mirrors models/registry.ts). */
export const WORKFLOWS: Record<string, WorkflowDef> = {
  [fetchThenSummarize.id]: fetchThenSummarize,
  // CREW-BUILDER:ENTRIES (generated workflow entries are inserted above this line — do not remove)
};

export function getWorkflow(name: string): WorkflowDef | undefined {
  return WORKFLOWS[name];
}
