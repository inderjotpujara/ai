import type { WorkflowDef } from '../src/workflow/types.ts';
import fetchThenSummarize from './fetch-then-summarize.ts';

/** name → workflow definition (mirrors models/registry.ts). */
export const WORKFLOWS: Record<string, WorkflowDef> = {
  [fetchThenSummarize.id]: fetchThenSummarize,
};

export function getWorkflow(name: string): WorkflowDef | undefined {
  return WORKFLOWS[name];
}
